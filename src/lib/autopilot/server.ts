// The payment wallet on the server: subscan's side of an Altana session.
// It never holds an admin key. It holds (sealed) a session key the user's own
// passkey wallet authorised with on-chain limits, and before anything is sent it
// re-checks those limits plus the user's saved recipients and per-transfer cap.
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
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseUnits, toHex, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN, RPC_URL, TEXTILE, TOKENS, type TokenSymbol } from "../celo/config.ts";
import { checkConversion, checkTransfer, type ApprovedRecipient, type CheckContext, type Refusal } from "../payments/engine.ts";
import { requestFirm, submit as textileSubmit, TextileError, type FirmQuote, type TakerProof } from "../textile/client.ts";
import { AUTOPILOT_APP_CODES, autopilotPermissions, TEMPLATE_VERSION, type AutopilotLimits } from "./permissions.ts";
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
  /** Largest single automated transfer or conversion, whole token units. */
  maxPerTransfer?: Partial<AutopilotLimits>;
  templateVersion?: number;
  issuedAt: number;
}

const cleanRecipients = (rs: ApprovedRecipient[]) =>
  (Array.isArray(rs) ? rs : [])
    .filter((r) => r && /^0x[0-9a-fA-F]{40}$/.test(r.address))
    .map((r) => ({ address: r.address, label: String(r.label ?? "").slice(0, 60) }))
    .slice(0, 50);
const cleanMax = (m: Partial<AutopilotLimits> | undefined): Partial<AutopilotLimits> => {
  const out: Partial<AutopilotLimits> = {};
  for (const t of ["USDT", "cNGN"] as const) if (m?.[t] && /^\d+(\.\d+)?$/.test(m[t]!)) out[t] = m[t];
  return out;
};

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
export async function activate(input: { sealedKey: string; session: SerializedSession; recipients: ApprovedRecipient[]; limits: AutopilotLimits; maxPerTransfer?: Partial<AutopilotLimits> }) {
  const wallet = input.session.walletAddress;
  const { key } = unseal<KeyGrant>(input.sealedKey, wallet.toLowerCase());
  const signer = signerFromPrivateKey(key);
  if (signer.publicKey.toLowerCase() !== input.session.publicKey.toLowerCase()) throw new Error("This grant is for a different subscan key.");
  const expected = serializeSession({ walletAddress: wallet, signer, publicKey: signer.publicKey, permissions: autopilotPermissions(input.limits), expiry: input.session.expiry } as Session).permissions;
  if (!sameJson(expected, input.session.permissions)) throw new Error("The granted permissions don't match Autopilot's limits.");
  const keyHash = keyHashForSessionOrKey(signer.publicKey);
  if (!(await accountHasKey(reader, wallet, keyHash))) throw new Error("Your wallet hasn't authorised subscan's key on Celo yet.");
  const policy: Policy = { v: 1, kind: "policy", key, session: input.session, recipients: cleanRecipients(input.recipients), limits: input.limits, maxPerTransfer: cleanMax(input.maxPerTransfer), templateVersion: TEMPLATE_VERSION, issuedAt: Math.floor(Date.now() / 1000) };
  return { sealedPolicy: seal(policy, wallet.toLowerCase()), keyHash };
}

/** Re-seal with new saved recipients and per-transfer caps (only the holder of the sealed policy can do this). */
export function updatePolicy(sealedPolicy: string, wallet: `0x${string}`, patch: { recipients?: ApprovedRecipient[]; maxPerTransfer?: Partial<AutopilotLimits> }) {
  const p = unseal<Policy>(sealedPolicy, wallet.toLowerCase());
  return seal({ ...p, ...(patch.recipients ? { recipients: cleanRecipients(patch.recipients) } : {}), ...(patch.maxPerTransfer ? { maxPerTransfer: cleanMax(patch.maxPerTransfer) } : {}) }, wallet.toLowerCase());
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
    maxPerTransfer: policy.maxPerTransfer ?? {},
    templateVersion: policy.templateVersion ?? 1,
    balances: { USDT: usdt.toString(), cNGN: cngn.toString() },
    remaining: { USDT: rUsdt.toString(), cNGN: rCngn.toString() },
  };
}

// Best-effort duplicate guard within one server instance. The browser records
// each movement's key before it asks, and the on-chain cap bounds any repeat.
const inFlight = new Set<string>();

export type ExecuteRequest =
  | { kind: "transfer"; key: string; token: TokenSymbol; amountAtomic: string; recipient: `0x${string}` }
  | { kind: "convert"; key: string; sellToken: TokenSymbol; buyToken: TokenSymbol; buyAmountAtomic?: string; sellAmountAtomic?: string; maxSellAtomic?: string };

export interface ExecuteResult {
  ok: boolean;
  status: "refused" | "processing" | "completed" | "failed";
  refusals?: Refusal[];
  transactionHash?: Hex;
  quote?: { rfqId: string; sellToken: TokenSymbol; buyToken: TokenSymbol; sellAmount: string; buyAmount: string; takerPays: string; feeAmount: string; expiresAt: string };
  error?: string;
  key: string;
}

async function context(policy: Policy, session: Session, wallet: `0x${string}`, key: string): Promise<CheckContext> {
  const keyHash = keyHashForSessionOrKey(session.publicKey);
  const [authorized, bU, bN, rU, rN] = await Promise.all([accountHasKey(reader, wallet, keyHash), balanceOf("USDT", wallet), balanceOf("cNGN", wallet), remainingOf(session, "USDT"), remainingOf(session, "cNGN")]);
  const max: CheckContext["maxPerTransfer"] = {};
  for (const t of ["USDT", "cNGN"] as const) if (policy.maxPerTransfer?.[t]) max[t] = parseUnits(policy.maxPerTransfer[t]!, TOKENS[t].decimals);
  return { now: Math.floor(Date.now() / 1000), expiry: policy.session.expiry, keyAuthorized: authorized, maxPerTransfer: max, remaining: { USDT: rU, cNGN: rN }, balances: { USDT: bU, cNGN: bN }, alreadyDone: inFlight.has(key) };
}

/**
 * Proof for a keyless Textile quote that this wallet is the taker, signed by the
 * session key through the wallet's ERC-1271 check. Textile may not accept it for
 * every wallet; if it doesn't, the conversion is refused and nothing moves.
 */
async function sessionProof(session: Session, wallet: `0x${string}`): Promise<TakerProof> {
  const nonce = toHex(randomBytes(32));
  const issuedAt = Date.now();
  const signature = await client().signOrderTypedData({
    session,
    typedData: {
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      types: { TakerControl: [{ name: "taker", type: "address" }, { name: "chainId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint256" }] },
      primaryType: "TakerControl",
      message: { taker: wallet, chainId: 42220n, nonce, issuedAt: BigInt(issuedAt) },
    },
  });
  return { nonce, issuedAt, signature };
}

async function firmQuote(req: Extract<ExecuteRequest, { kind: "convert" }>, session: Session, wallet: `0x${string}`): Promise<{ quote?: FirmQuote; error?: string }> {
  const body = { sellToken: req.sellToken, buyToken: req.buyToken, ...(req.buyAmountAtomic ? { buyAmount: req.buyAmountAtomic } : { sellAmount: req.sellAmountAtomic }) };
  try {
    const proof = process.env.TEXTILE_API_KEY ? undefined : await sessionProof(session, wallet).catch(() => undefined);
    const q = await requestFirm(body, wallet, proof);
    if (q.status !== "quoted" || !q.quote || !q.transactions) return { error: q.reason ?? "Textile FX has no quote for this amount right now." };
    if (q.quote.reactor.toLowerCase() !== TEXTILE.reactor.toLowerCase() || q.transactions.swap.to.toLowerCase() !== TEXTILE.reactor.toLowerCase()) return { error: "The conversion points at an unexpected contract, so it was stopped." };
    if (q.quote.taker.toLowerCase() !== wallet.toLowerCase()) return { error: "The quote is for a different wallet, so it was stopped." };
    if (req.buyAmountAtomic && BigInt(q.quote.buyAmount) < BigInt(req.buyAmountAtomic)) return { error: "The quote gives less than asked, so it was stopped." };
    return { quote: q };
  } catch (e) {
    return { error: e instanceof TextileError ? `${e.message}${e.reason ? ` (${e.reason})` : ""}` : (e as Error).message };
  }
}

/**
 * Run one movement the user's rules call for, inside their granted access:
 * check everything → (Textile firm quote for a conversion) → one Altana batch →
 * wait for the receipt. "completed" only when the receipt says success.
 */
export async function execute(input: { sealedPolicy: string; wallet: `0x${string}`; request: ExecuteRequest }): Promise<ExecuteResult> {
  const { policy, session } = openPolicy(input.sealedPolicy, input.wallet);
  const req = input.request;
  const ctx = await context(policy, session, input.wallet, req.key);
  const calls: { to: `0x${string}`; data: Hex; value: bigint }[] = [];
  let quoteOut: ExecuteResult["quote"];
  let firm: FirmQuote | undefined;

  if (req.kind === "transfer") {
    const amount = BigInt(req.amountAtomic);
    const refusals = checkTransfer({ token: req.token, amount, recipient: req.recipient }, policy.recipients, ctx);
    if (refusals.length) return { ok: false, status: "refused", refusals, key: req.key };
    calls.push({ to: TOKENS[req.token].address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [req.recipient, amount] }), value: 0n });
  } else {
    const templateOk = req.sellToken === "USDT" || (policy.templateVersion ?? 1) >= 2;
    const got = templateOk ? await firmQuote(req, session, input.wallet) : {};
    firm = got.quote;
    const sellAmount = firm?.quote ? BigInt(firm.quote.takerPays) : BigInt(req.sellAmountAtomic ?? "0") || 1n;
    if (firm?.quote) quoteOut = { rfqId: firm.rfqId, sellToken: req.sellToken, buyToken: req.buyToken, sellAmount: firm.quote.sellAmount, buyAmount: firm.quote.buyAmount, takerPays: firm.quote.takerPays, feeAmount: firm.quote.feeAmount, expiresAt: firm.quote.expiresAt };
    const refusals = checkConversion({ sellToken: req.sellToken, sellAmount, routeOk: !!firm?.quote, templateOk }, ctx);
    if (req.maxSellAtomic && sellAmount > BigInt(req.maxSellAtomic)) refusals.push("over_rule_max");
    if (refusals.length) return { ok: false, status: "refused", refusals, quote: quoteOut, error: got.error, key: req.key };
    if (Date.now() >= Date.parse(firm!.quote!.expiresAt)) return { ok: false, status: "failed", quote: quoteOut, error: "The conversion quote expired before it could be used. Nothing was sent.", key: req.key };
    calls.push({ to: TOKENS[req.sellToken].address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TEXTILE.reactor, BigInt(firm!.quote!.takerPays)] }), value: 0n });
    const swap = firm!.transactions!.swap;
    calls.push({ to: swap.to, data: swap.data, value: BigInt(swap.value) });
  }

  inFlight.add(req.key);
  try {
    // Fee in USD₮ (accepted by the Celo relay), paid inside the USD₮ cap.
    const res = await client().execute({ session, calls, chainId: 42220, feeToken: TOKENS.USDT.address });
    if (firm && res.transactionHash) void textileSubmit(firm.rfqId, firm.claimToken, res.transactionHash).catch(() => {});
    if (!res.transactionHash) return { ok: false, status: "failed", quote: quoteOut, error: "The wallet didn't send it. Nothing moved.", key: req.key };
    if (res.status !== "CONFIRMED") return { ok: false, status: res.status === "PENDING" ? "processing" : "failed", transactionHash: res.transactionHash, quote: quoteOut, error: res.status === "PENDING" ? "Sent, waiting for Celo to confirm." : "The wallet rejected it.", key: req.key };
    const receipt = await chain.waitForTransactionReceipt({ hash: res.transactionHash, timeout: 60_000 });
    if (receipt.status !== "success") return { ok: false, status: "failed", transactionHash: res.transactionHash, quote: quoteOut, error: "The transaction reverted on Celo. Nothing moved.", key: req.key };
    return { ok: true, status: "completed", transactionHash: res.transactionHash, quote: quoteOut, key: req.key };
  } catch (e) {
    inFlight.delete(req.key);
    const msg = (e as { code?: string; message?: string }).code ? `${(e as { code: string }).code}: ${(e as Error).message}` : (e as Error).message;
    return { ok: false, status: "failed", quote: quoteOut, error: msg.slice(0, 400), key: req.key };
  }
}
