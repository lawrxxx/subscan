// Live Celo mainnet tests for Autopilot (Altana session + Textile FX + subscan's server code).
// Run from the repo root:  node --experimental-strip-types scripts/autopilot-mainnet-test.ts <dir with keys.json>
// keys.json holds {"admin": "0x…", "agent": "0x…"}; never commit it. Spends small real amounts on Celo mainnet.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, encodeFunctionData, erc20Abi, http, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO, createClient, deserializeSession, parseAttribution, serializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import { autopilotPermissions, AUTOPILOT_APP_CODES } from "../src/lib/autopilot/permissions.ts";
import { TEXTILE, TOKENS } from "../src/lib/celo/config.ts";

const dir = process.argv[2];
const keys = JSON.parse(readFileSync(`${dir}/keys.json`, "utf8"));
keys.recipient ??= generatePrivateKey();
keys.agent2 ??= generatePrivateKey();
keys.seal ??= randomBytes(32).toString("hex");
process.env.AUTOPILOT_SEAL_KEY ??= keys.seal;
writeFileSync(`${dir}/keys.json`, JSON.stringify(keys), { mode: 0o600 });
const server = await import("../src/lib/autopilot/server.ts");
const { requestFirm } = await import("../src/lib/textile/client.ts");

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const client = createClient({ chains: [CELO], appCode: AUTOPILOT_APP_CODES, agentIdentity: { name: "subscan Autopilot", description: "Pays a person's recurring bills from their own Altana wallet within the limits they grant.", endpoint: "https://subscan-rosy.vercel.app/api/erc8004" } });
const admin = signerFromPrivateKey(keys.admin);
const wallet = await client.createWallet({ signer: admin });
const recipient = privateKeyToAccount(keys.recipient).address;
const log: Record<string, unknown>[] = [];
const out = (step: string, ok: boolean, detail: Record<string, unknown> = {}) => {
  const row = { step, ok, ...detail };
  log.push(row);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}`, JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const usdt = (n: string) => BigInt(Math.round(Number(n) * 1e6));
const transfer = (token: "USDT" | "cNGN", to: `0x${string}`, amount: bigint) => ({ to: TOKENS[token].address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }), value: 0n });
const expectReject = async (step: string, run: () => Promise<{ status?: string; transactionHash?: Hex }>) => {
  try {
    const r = await run();
    out(step, r.status !== "CONFIRMED", { status: r.status, tx: r.transactionHash, note: r.status === "CONFIRMED" ? "UNEXPECTEDLY CONFIRMED" : "rejected" });
  } catch (e) {
    out(step, true, { rejectedWith: (e as { code?: string }).code ?? (e as Error).name, message: (e as Error).message.slice(0, 220) });
  }
};

console.log("wallet", wallet.address, "recipient", recipient);
const limits = { USDT: "2", cNGN: "1600" }; // Textile's minimum order is ~1,440 cNGN

// 1. Grant
const key = server.issueKey(wallet.address as `0x${string}`);
const agentSigner = signerFromPrivateKey(keys.agent);
const grant = await client.grantSession({ wallet, signer: admin, permissions: autopilotPermissions(limits), expiry: Math.floor(Date.now() / 1000) + 3600, sessionSigner: { ...agentSigner, publicKey: key.publicKey, signDigest: async () => { throw new Error("public only"); } }, chainId: 42220, feeToken: TOKENS.USDT.address, register: false });
const grantTx = (grant as { transactionHash?: Hex }).transactionHash;
out("1. grant session (calls allowlist + monthly caps + 1h expiry)", grant.status === "granted", { grantTx, keyHash: grant.keyHash, agentIdentity: (grant as { agentIdentity?: unknown }).agentIdentity });
const serialized = serializeSession(grant);
const act = await server.activate({ sealedKey: key.sealedKey, session: serialized, recipients: [{ address: recipient, label: "Test landlord" }], limits });
out("1b. subscan server confirms the grant on-chain and seals the key", !!act.sealedPolicy, { keyHash: act.keyHash });

// 2. Eligible payment through subscan's server
const pay1 = await server.pay({ sealedPolicy: act.sealedPolicy, wallet: wallet.address as `0x${string}`, enabled: true, alreadyPaid: false, request: { billId: "test-rent", billName: "Test rent", recipient, token: "USDT", amountAtomic: usdt("0.10").toString(), dueDate: new Date().toISOString().slice(0, 10) } });
let tag: unknown = null;
if (pay1.transactionHash) tag = parseAttribution((await pub.getTransaction({ hash: pay1.transactionHash })).input);
out("2. eligible payment via subscan server (0.10 USD₮ to approved recipient)", pay1.ok, { tx: pay1.transactionHash, stage: pay1.stage, attribution: tag, error: pay1.error });

// 3. Unapproved recipient (subscan's policy)
const pay2 = await server.pay({ sealedPolicy: act.sealedPolicy, wallet: wallet.address as `0x${string}`, enabled: true, alreadyPaid: false, request: { billId: "x", billName: "Stranger", recipient: "0x000000000000000000000000000000000000dEaD", token: "USDT", amountAtomic: usdt("0.10").toString(), dueDate: "2026-12-01" } });
out("3. unapproved recipient refused by subscan before signing", !pay2.ok && !!pay2.refusals?.includes("recipient_not_approved"), { refusals: pay2.refusals });

// For direct on-chain checks, act with the session key itself (bypassing subscan's checks on purpose).
const sealedSession = deserializeSession(serialized, signerFromPrivateKey((await import("../src/lib/autopilot/seal.ts")).unseal<{ key: Hex }>(act.sealedPolicy, wallet.address.toLowerCase()).key));

// 4. Over the cap: enforced by the account contract
await expectReject("4. over the monthly cap (2.5 USD₮ > 2 USD₮) rejected on-chain", () => client.execute({ session: sealedSession, chainId: 42220, calls: [transfer("USDT", recipient, usdt("2.5"))], feeToken: TOKENS.USDT.address }));

// 5. Outside the call allowlist: cNGN.approve is not granted
await expectReject("5. call outside the allowlist (cNGN.approve) rejected on-chain", () => client.execute({ session: sealedSession, chainId: 42220, calls: [{ to: TOKENS.cNGN.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [recipient, 1n] }), value: 0n }], feeToken: TOKENS.USDT.address }));

// 6. Textile FX conversion inside the session: approve + swap + pay cNGN, one atomic batch.
try {
  const buy = "1450000000"; // 1,450 cNGN (above Textile's minimum)
  let firm;
  try {
    firm = await requestFirm({ sellToken: "USDT", buyToken: "cNGN", buyAmount: buy }, wallet.address as `0x${string}`);
  } catch (e) {
    // Keyless: prove control of the taker (this test wallet's admin is its EIP-7702 EOA key).
    const nonce = toHex(randomBytes(32));
    const issuedAt = Date.now();
    const signature = await privateKeyToAccount(keys.admin).signTypedData({ domain: { name: "Textile Taker Control", version: "1", chainId: 42220 }, types: { TakerControl: [{ name: "taker", type: "address" }, { name: "chainId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint256" }] }, primaryType: "TakerControl", message: { taker: wallet.address, chainId: 42220n, nonce, issuedAt: BigInt(issuedAt) } });
    firm = await requestFirm({ sellToken: "USDT", buyToken: "cNGN", buyAmount: buy }, wallet.address as `0x${string}`, { nonce, issuedAt, signature });
  }
  if (firm.status !== "quoted" || !firm.quote || !firm.transactions) throw new Error(`no quote: ${firm.reason}`);
  out("6a. Textile firm quote for the Autopilot wallet", true, { rfqId: firm.rfqId, takerPays: firm.quote.takerPays, buyAmount: firm.quote.buyAmount, fee: firm.quote.feeAmount, expiresAt: firm.quote.expiresAt });
  const r = await client.execute({
    session: sealedSession,
    chainId: 42220,
    feeToken: TOKENS.USDT.address,
    calls: [
      { to: TOKENS.USDT.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TEXTILE.reactor, BigInt(firm.quote.takerPays)] }), value: 0n },
      { to: firm.transactions.swap.to, data: firm.transactions.swap.data, value: BigInt(firm.transactions.swap.value) },
      transfer("cNGN", recipient, BigInt(buy)),
    ],
  });
  let t2: unknown = null;
  if (r.transactionHash) {
    await pub.waitForTransactionReceipt({ hash: r.transactionHash });
    t2 = parseAttribution((await pub.getTransaction({ hash: r.transactionHash })).input);
    await (await import("../src/lib/textile/client.ts")).submit(firm.rfqId, firm.claimToken, r.transactionHash).catch(() => {});
  }
  out("6b. convert USD₮→cNGN on Textile and pay 1,450 cNGN, one session transaction", r.status === "CONFIRMED", { tx: r.transactionHash, attribution: t2 });
} catch (e) {
  out("6. Textile conversion inside the session", false, { error: (e as Error).message.slice(0, 300) });
}

// 7. Expiry: a second session that lives 2 minutes
const s2 = await client.grantSession({ wallet, signer: admin, permissions: autopilotPermissions(limits), expiry: Math.floor(Date.now() / 1000) + 120, sessionSigner: signerFromPrivateKey(keys.agent2), chainId: 42220, feeToken: TOKENS.USDT.address, register: false });
out("7a. short-lived session granted (expires in 2 min)", s2.status === "granted", { tx: (s2 as { transactionHash?: Hex }).transactionHash });
console.log("waiting for expiry…");
await new Promise((r) => setTimeout(r, 150_000));
await expectReject("7b. payment after expiry rejected", () => client.execute({ session: s2, chainId: 42220, calls: [transfer("USDT", recipient, usdt("0.01"))], feeToken: TOKENS.USDT.address }));

// 8. Revoke, then try
const rv = await client.revokeSession({ wallet, signer: admin, session: key.publicKey, feeToken: TOKENS.USDT.address });
out("8a. revoke subscan's session (one transaction)", true, { tx: (rv as { transactionHash?: Hex }).transactionHash });
await expectReject("8b. payment after revoke rejected", () => client.execute({ session: sealedSession, chainId: 42220, calls: [transfer("USDT", recipient, usdt("0.01"))], feeToken: TOKENS.USDT.address }));
const after = await server.pay({ sealedPolicy: act.sealedPolicy, wallet: wallet.address as `0x${string}`, enabled: true, alreadyPaid: false, request: { billId: "test-rent-2", billName: "Test rent", recipient, token: "USDT", amountAtomic: usdt("0.05").toString(), dueDate: "2026-12-31" } });
out("8c. subscan server sees the revoke and refuses", !after.ok && !!after.refusals?.includes("key_not_authorized"), { refusals: after.refusals });

writeFileSync(`${dir}/evidence.json`, JSON.stringify({ wallet: wallet.address, recipient, at: new Date().toISOString(), log }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("evidence written");
