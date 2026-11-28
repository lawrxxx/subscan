// Autopilot on the server: the agent's side of an Altana session.
// It never holds an admin key. It holds (sealed) a session key the user's own
// passkey wallet authorised with on-chain limits, and it re-checks those limits
// plus the user's approved recipients before anything is sent.
import {
  accountHasKey,
  CELO,
  checkX402SpendCap,
  createClient,
  deserializeSession,
  getKey,
  keyHashForSessionOrKey,
  serializeSession,
  signerFromPrivateKey,
  type SerializedSession,
  type Session,
} from "@altananetwork/sdk";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN, RPC_URL, TEXTILE, TOKENS, type TokenSymbol } from "../celo/config.ts";
import { checkAutopay, idempotencyKey, type ApprovedRecipient, type AutopayContext, type AutopayRequest, type Refusal } from "../payments/engine.ts";
import { requestFirm, submit as textileSubmit, TextileError, type FirmQuote } from "../textile/client.ts";
import { AUTOPILOT_APP_CODES, autopilotPermissions, type AutopilotLimits } from "./permissions.ts";
import { seal, unseal } from "./seal.ts";

const chain = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
// Same viem client type the SDK reads with.
const reader = chain as unknown as Parameters<typeof accountHasKey>[0];

let altana: ReturnType<typeof createClient> | null = null;
function client() {
  return (altana ??= createClient({ chains: [CELO], appCode: AUTOPILOT_APP_CODES, agentIdentity: false }));
}

interface KeyGrant {
  v: 1;
  kind: "key";
  key: Hex;
}
export interface Policy {
  v: 1;
  kind: "policy";
  key: Hex;
  session: SerializedSession;
  recipients: ApprovedRecipient[];
  limits: AutopilotLimits;
  issuedAt: number;
}

/** Step 1: a fresh agent key for this user. Only its public half leaves the server in clear. */
export function issueKey(wallet: `0x${string}`) {
  const key = generatePrivateKey();
  const signer = signerFromPrivateKey(key);
  return { publicKey: signer.publicKey, address: privateKeyToAccount(key).address, sealedKey: seal({ v: 1, kind: "key", key } satisfies KeyGrant, wallet.toLowerCase()) };
}

function sameJson(a: unknown, b: unknown) {
  const norm = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? v.toLowerCase() : typeof v === "bigint" ? v.toString() : v));
  return norm(a) === norm(b);
}

/**
 * Step 2, after the user's passkey granted the session: confirm on-chain that the
 * wallet now holds this key, that it was granted exactly the Autopilot template,
 * then seal the key together with the user's approved recipients.
 */
export async function activate(input: { sealedKey: string; session: SerializedSession; recipients: ApprovedRecipient[]; limits: AutopilotLimits }) {
  const wallet = input.session.walletAddress;
  const { key } = unseal<KeyGrant>(input.sealedKey, wallet.toLowerCase());
  const signer = signerFromPrivateKey(key);
  if (signer.publicKey.toLowerCase() !== input.session.publicKey.toLowerCase()) throw new Error("This grant is for a different subscan key.");
  const expected = serializeSession({ walletAddress: wallet, signer, publicKey: signer.publicKey, permissions: autopilotPermissions(input.limits), expiry: input.session.expiry } as Session).permissions;
  if (!sameJson(expected, input.session.permissions)) throw new Error("The granted permissions don't match Autopilot's limits.");
  const keyHash = keyHashForSessionOrKey(signer.publicKey);
  if (!(await accountHasKey(reader, wallet, keyHash))) throw new Error("Your wallet hasn't authorised subscan's key on Celo yet.");
  const recipients = input.recipients.filter((r) => /^0x[0-9a-fA-F]{40}$/.test(r.address)).slice(0, 25);
  const policy: Policy = { v: 1, kind: "policy", key, session: input.session, recipients, limits: input.limits, issuedAt: Math.floor(Date.now() / 1000) };
  return { sealedPolicy: seal(policy, wallet.toLowerCase()), keyHash };
}

/** Re-seal with a new approved-recipient list (only the holder of the sealed policy can do this). */
export function updateRecipients(sealedPolicy: string, wallet: `0x${string}`, recipients: ApprovedRecipient[]) {
  const p = unseal<Policy>(sealedPolicy, wallet.toLowerCase());
  return seal({ ...p, recipients: recipients.slice(0, 25) }, wallet.toLowerCase());
}

function openPolicy(sealedPolicy: string, wallet: `0x${string}`) {
  const p = unseal<Policy>(sealedPolicy, wallet.toLowerCase());
  const session = deserializeSession(p.session, signerFromPrivateKey(p.key));
  return { policy: p, session };
}

async function balanceOf(t: TokenSymbol, owner: `0x${string}`) {
  return chain.readContract({ address: TOKENS[t].address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

async function remainingOf(session: Session, t: TokenSymbol): Promise<bigint> {
  const status = await checkX402SpendCap(session, { asset: TOKENS[t].address, amount: "0", network: "eip155:42220" } as never, { network: CELO, publicClient: reader as never });
  return status.caps.length ? status.caps.reduce((m, c) => (c.remaining < m ? c.remaining : m), status.caps[0].remaining) : 0n;
}

/** What the account says right now: authorised?, expiry, remaining allowance and balances. */
export async function status(sealedPolicy: string, wallet: `0x${string}`) {
  const { policy, session } = openPolicy(sealedPolicy, wallet);
  const keyHash = keyHashForSessionOrKey(session.publicKey);
  const authorized = await accountHasKey(reader, wallet, keyHash);
  const onchainExpiry = authorized ? (await getKey(reader, wallet, keyHash)).expiry : 0;
  const [usdt, cngn, rUsdt, rCngn] = await Promise.all([balanceOf("USDT", wallet), balanceOf("cNGN", wallet), remainingOf(session, "USDT"), remainingOf(session, "cNGN")]);
  return {
    authorized,
    expiry: policy.session.expiry,
    onchainExpiry,
    recipients: policy.recipients,
    limits: policy.limits,
    balances: { USDT: usdt.toString(), cNGN: cngn.toString() },
    remaining: { USDT: rUsdt.toString(), cNGN: rCngn.toString() },
  };
}

// Best-effort duplicate guard within one server instance. The browser also
// records the idempotency key, and the on-chain cap bounds any repeat.
const inFlight = new Set<string>();

export interface PayResult {
  ok: boolean;
  refusals?: Refusal[];
  stage: "prepared" | "quoted" | "submitted" | "confirmed" | "failed";
  transactionHash?: Hex;
  callsId?: Hex;
  quote?: { rfqId: string; sell: string; buy: string; takerPays: string; feeAmount: string; rateRay: string; expiresAt: string };
  source: TokenSymbol;
  error?: string;
  idempotencyKey: string;
}

/**
 * The shared engine's autonomous path:
 * validate → (Textile firm quote if the bill needs another token) → one atomic
 * Altana batch [approve, swap, transfer] or [transfer] → wait for the receipt.
 */
export async function pay(input: { sealedPolicy: string; wallet: `0x${string}`; request: Omit<AutopayRequest, "amountAtomic"> & { amountAtomic: string }; enabled: boolean; alreadyPaid: boolean }): Promise<PayResult> {
  const { policy, session } = openPolicy(input.sealedPolicy, input.wallet);
  const req: AutopayRequest = { ...input.request, amountAtomic: BigInt(input.request.amountAtomic) };
  const idem = idempotencyKey(input.wallet, req);
  const want = req.token;
  const other: TokenSymbol = want === "USDT" ? "cNGN" : "USDT";
  const keyHash = keyHashForSessionOrKey(session.publicKey);
  const [authorized, bWant, bOther, rWant, rOther] = await Promise.all([
    accountHasKey(reader, input.wallet, keyHash),
    balanceOf(want, input.wallet),
    balanceOf(other, input.wallet),
    remainingOf(session, want),
    remainingOf(session, other),
  ]);
  const balances = { [want]: bWant, [other]: bOther } as Record<TokenSymbol, bigint>;
  const remaining = { [want]: rWant, [other]: rOther } as Record<TokenSymbol, bigint>;

  // Pay directly when the wallet holds the bill's token; otherwise convert from the other one.
  const direct = bWant >= req.amountAtomic;
  let quote: FirmQuote | null = null;
  let conversionError: string | undefined;
  if (!direct) {
    try {
      quote = await requestFirm({ sellToken: other, buyToken: want, buyAmount: req.amountAtomic.toString() }, input.wallet);
      if (quote.status !== "quoted" || !quote.quote) conversionError = quote.reason ?? "no_quote";
      else if (BigInt(quote.quote.buyAmount) < req.amountAtomic) conversionError = "quote_short";
      else if (quote.quote.reactor.toLowerCase() !== TEXTILE.reactor.toLowerCase()) conversionError = "unexpected_reactor";
    } catch (e) {
      conversionError = e instanceof TextileError ? `${e.message}${e.reason ? ` (${e.reason})` : ""}` : String(e);
    }
  }
  const source = direct ? want : other;
  const sourceNeeded = direct ? req.amountAtomic : quote?.quote ? BigInt(quote.quote.takerPays) : req.amountAtomic;
  const ctx: AutopayContext = {
    now: Math.floor(Date.now() / 1000),
    enabled: input.enabled,
    expiry: policy.session.expiry,
    revoked: false,
    keyAuthorized: authorized,
    recipients: policy.recipients,
    remaining,
    balances,
    source,
    sourceNeeded,
    conversionAvailable: direct || (!!quote?.quote && !conversionError),
    alreadyPaid: input.alreadyPaid || inFlight.has(idem),
  };
  const refusals = checkAutopay(req, ctx);
  const q = quote?.quote ? { rfqId: quote.rfqId, sell: other, buy: want, takerPays: quote.quote.takerPays, feeAmount: quote.quote.feeAmount, rateRay: quote.quote.rateRay, expiresAt: quote.quote.expiresAt } : undefined;
  if (refusals.length) return { ok: false, refusals, stage: "prepared", source, quote: q, error: conversionError, idempotencyKey: idem };

  const calls: { to: `0x${string}`; data: Hex; value: bigint }[] = [];
  if (!direct && quote?.quote && quote.transactions) {
    if (Date.now() >= Date.parse(quote.quote.expiresAt)) return { ok: false, stage: "quoted", source, quote: q, error: "The conversion quote expired before it could be used.", idempotencyKey: idem };
    calls.push({ to: TOKENS[other].address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TEXTILE.reactor, BigInt(quote.quote.takerPays)] }), value: 0n });
    const swap = quote.transactions.swap;
    if (swap.to.toLowerCase() !== TEXTILE.reactor.toLowerCase()) return { ok: false, stage: "quoted", source, quote: q, error: "Conversion transaction targets an unexpected contract.", idempotencyKey: idem };
    calls.push({ to: swap.to, data: swap.data, value: BigInt(swap.value) });
  }
  calls.push({ to: TOKENS[want].address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [req.recipient, req.amountAtomic] }), value: 0n });

  inFlight.add(idem);
  try {
    // Fee in USD₮ (accepted by the Celo relay), paid inside the USD₮ cap.
    const res = await client().execute({ session, calls, chainId: 42220, feeToken: TOKENS.USDT.address });
    if (q && res.transactionHash) void textileSubmit(q.rfqId, quote!.claimToken, res.transactionHash).catch(() => {});
    if (res.status !== "CONFIRMED" || !res.transactionHash) return { ok: false, stage: res.status === "PENDING" ? "submitted" : "failed", transactionHash: res.transactionHash, callsId: res.callsId, source, quote: q, error: res.status === "PENDING" ? "Sent, waiting for confirmation." : "The payment was rejected.", idempotencyKey: idem };
    const receipt = await chain.waitForTransactionReceipt({ hash: res.transactionHash, timeout: 60_000 });
    if (receipt.status !== "success") return { ok: false, stage: "failed", transactionHash: res.transactionHash, source, quote: q, error: "The payment transaction reverted on Celo.", idempotencyKey: idem };
    return { ok: true, stage: "confirmed", transactionHash: res.transactionHash, callsId: res.callsId, source, quote: q, idempotencyKey: idem };
  } catch (e) {
    inFlight.delete(idem);
    const msg = (e as { code?: string; message?: string }).code ? `${(e as { code: string }).code}: ${(e as Error).message}` : (e as Error).message;
    return { ok: false, stage: "failed", source, quote: q, error: msg.slice(0, 400), idempotencyKey: idem };
  }
}
