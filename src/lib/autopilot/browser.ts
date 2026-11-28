"use client";
// Autopilot in the browser: the user's side of the Altana wallet.
// The passkey (Face ID / Touch ID) is the wallet's admin and never leaves the
// device. subscan's agent key is created on the server and only its public key
// is shown here; the passkey grants that key a session with on-chain limits.
import { CELO, createClient, formatQuoteLine, serializeSession, signerFromPasskey, signerFromPrivateKey, type Signer } from "@altananetwork/sdk";
import { formatUnits, parseUnits, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { TOKENS, type TokenSymbol } from "../celo/config";
import { erc20TransferData, sendTx, waitForReceipt } from "../celo/wallet";
import type { AutopilotRecipient } from "../types";
import { AUTOPILOT_APP_CODES, autopilotPermissions, type AutopilotLimits } from "./permissions";

let altana: ReturnType<typeof createClient> | null = null;
function client() {
  return (altana ??= createClient({
    chains: [CELO],
    appCode: AUTOPILOT_APP_CODES,
    // The wallet's own ERC-8004 identity, registered by the SDK after its first admin action.
    agentIdentity: {
      name: "subscan Autopilot",
      description: "Pays a person's recurring bills from their own Altana wallet, within the limits, recipients and expiry they granted.",
      endpoint: typeof window !== "undefined" ? `${window.location.origin}/api/erc8004` : undefined,
    },
  }));
}

export async function api<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Autopilot request failed");
  return j.data as T;
}

export async function autopilotAvailable(): Promise<{ available: boolean; conversions: boolean }> {
  const r = await fetch("/api/autopilot").then((x) => x.json()).catch(() => null);
  return r?.data ?? { available: false, conversions: false };
}

export function passkeysSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/** Create the user's Autopilot wallet. One passkey prompt. Nothing is sent on-chain yet. */
export async function createAutopilotWallet() {
  const w = await client().createPasskeyWallet({ name: "subscan Autopilot" });
  const c = w.signer.credential;
  return { address: w.address as `0x${string}`, passkey: c.kind === "webauthn" ? { kind: "webauthn" as const, id: c.id, publicKey: c.publicKey, rpId: c.rpId } : undefined };
}

type Passkey = { kind: "webauthn"; id: string; publicKey: `0x${string}`; rpId?: string };

/**
 * The wallet's admin signer. On the device that created it, rebuilt from the
 * saved public credential (the biometric prompt comes when it signs). Elsewhere,
 * recovered with the passkey picker, which needs the wallet to have been used once.
 */
async function admin(wallet: `0x${string}`, passkey?: Passkey): Promise<{ wallet: { address: `0x${string}` }; signer: Signer }> {
  if (passkey) return { wallet: { address: wallet }, signer: signerFromPasskey(passkey) };
  const w = await client().recoverFromPasskey();
  return { wallet: { address: w.address as `0x${string}` }, signer: w.signer };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} took too long. Check the wallet has a little USD₮ or CELO for the network fee, then try again.`)), ms))]);
}

/** Move money from the user's connected wallet (MiniPay, MetaMask) into Autopilot. */
export async function fund(from: `0x${string}`, to: `0x${string}`, token: TokenSymbol, amount: string, gasUsdt: boolean) {
  const atomic = parseUnits(amount, TOKENS[token].decimals);
  const h = await sendTx(from, { to: TOKENS[token].address, data: erc20TransferData(to, atomic) }, { payGasInUsdt: gasUsdt });
  const r = await waitForReceipt(h);
  if (r.status !== "success") throw new Error("The transfer reverted.");
  return h;
}

/**
 * Grant subscan's agent a session: only the four allowed calls, monthly caps,
 * an expiry. Enforced by the wallet contract on Celo. Then the server confirms
 * the grant on-chain and seals the key with the approved recipients.
 */
export async function grant(opts: { wallet: `0x${string}`; passkey?: Passkey; limits: AutopilotLimits; days: number; recipients: AutopilotRecipient[] }) {
  const key = await api<{ publicKey: Hex; address: `0x${string}`; sealedKey: string }>({ action: "key", wallet: opts.wallet });
  const { wallet, signer } = await admin(opts.wallet, opts.passkey);
  if (wallet.address.toLowerCase() !== opts.wallet.toLowerCase()) throw new Error("That passkey belongs to a different Autopilot wallet.");
  // Only the public key is needed to grant; the private key stays sealed on subscan's server.
  const agent: Signer = { type: "privateKey", address: key.address, publicKey: key.publicKey, signDigest: async () => { throw new Error("subscan's agent key signs on the server only"); } };
  const expiry = Math.floor(Date.now() / 1000) + opts.days * 86_400;
  const result = await withTimeout(client().grantSession({ wallet, signer, permissions: autopilotPermissions(opts.limits), expiry, sessionSigner: agent, chainId: 42220, register: false }), 150_000, "Giving access");
  if (result.status !== "granted") throw new Error(result.legs.find((l) => l.status === "FAILED")?.reason ?? "The wallet didn't authorise subscan.");
  const session = serializeSession(result);
  const tx = (result as { transactionHash?: Hex }).transactionHash ?? result.legs.find((l) => l.kind === "account")?.transactionHash;
  const { sealedPolicy } = await api<{ sealedPolicy: string }>({ action: "activate", sealedKey: key.sealedKey, session, recipients: opts.recipients, limits: opts.limits });
  return { sealedPolicy, expiry, agentPublicKey: key.publicKey, grantTx: tx };
}

/** What giving access will cost, from Altana's relay. Signs nothing. */
export async function quoteGrant(opts: { wallet: `0x${string}`; passkey?: Passkey; limits: AutopilotLimits; days: number }) {
  if (!opts.passkey) return null;
  const signer = signerFromPasskey(opts.passkey);
  const probe = signerFromPrivateKey(generatePrivateKey()); // a stand-in key, only to price the call
  const q = await client().quoteGrantSession({ wallet: { address: opts.wallet }, signer, permissions: autopilotPermissions(opts.limits), expiry: Math.floor(Date.now() / 1000) + opts.days * 86_400, sessionSigner: probe, chainId: 42220, register: false });
  const registration = q.lines.reduce((x, l) => x + l.value, 0n);
  return {
    registrationCelo: Number(formatUnits(registration, 18)),
    lines: q.lines.map((l) => formatQuoteLine(l, CELO)),
    celoBalance: Number(formatUnits(q.balances.find((b) => /^0x0{40}$/i.test(b.token))?.balance ?? 0n, 18)),
    complete: q.complete,
  };
}

/** Revoke subscan's access. One transaction; immediate and permanent for that key. */
export async function revoke(wallet: `0x${string}`, agentPublicKey: Hex, passkey?: Passkey) {
  const a = await admin(wallet, passkey);
  const r = await withTimeout(client().revokeSession({ wallet: a.wallet, signer: a.signer, session: agentPublicKey }), 150_000, "Revoking access");
  return (r as { transactionHash?: Hex }).transactionHash;
}

export interface AutopilotStatus {
  authorized: boolean;
  expiry: number;
  onchainExpiry: number;
  balances: { USDT: string; cNGN: string };
  remaining: { USDT: string; cNGN: string };
}

export function status(sealedPolicy: string, wallet: `0x${string}`) {
  return api<AutopilotStatus>({ action: "status", sealedPolicy, wallet });
}

export function updateRecipients(sealedPolicy: string, wallet: `0x${string}`, recipients: AutopilotRecipient[]) {
  return api<{ sealedPolicy: string }>({ action: "recipients", sealedPolicy, wallet, recipients });
}

export interface PayResponse {
  ok: boolean;
  stage: "prepared" | "quoted" | "submitted" | "confirmed" | "failed";
  refusals?: string[];
  refusalText?: string[];
  transactionHash?: Hex;
  source: TokenSymbol;
  quote?: { rfqId: string; sell: string; buy: string; takerPays: string; feeAmount: string; rateRay: string; expiresAt: string };
  error?: string;
  idempotencyKey: string;
}

export function payNow(input: { sealedPolicy: string; wallet: `0x${string}`; enabled: boolean; alreadyPaid: boolean; request: { billId: string; billName: string; recipient: `0x${string}`; token: TokenSymbol; amountAtomic: string; dueDate: string } }) {
  return api<PayResponse>({ action: "pay", ...input });
}
