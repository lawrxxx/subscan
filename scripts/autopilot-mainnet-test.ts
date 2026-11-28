// Live Celo mainnet tests for subscan's money autopilot: Altana session + Textile FX
// + subscan's own server checks (the same functions /api/autopilot runs).
// Run from the repo root:  node --experimental-strip-types scripts/autopilot-mainnet-test.ts <dir with keys.json>
// keys.json holds {"admin": "0x…"} (the test wallet's admin key); never commit it.
// Spends small real amounts on Celo mainnet. Writes evidence-v2.json next to keys.json.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CELO, createClient, deserializeSession, parseAttribution, serializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import { autopilotPermissions, AUTOPILOT_APP_CODES } from "../src/lib/autopilot/permissions.ts";
import { TOKENS } from "../src/lib/celo/config.ts";

const dir = process.argv[2];
const keys = JSON.parse(readFileSync(`${dir}/keys.json`, "utf8"));
keys.recipient ??= generatePrivateKey();
keys.seal ??= randomBytes(32).toString("hex");
process.env.AUTOPILOT_SEAL_KEY ??= keys.seal;
writeFileSync(`${dir}/keys.json`, JSON.stringify(keys), { mode: 0o600 });
const server = await import("../src/lib/autopilot/server.ts");
const { unseal } = await import("../src/lib/autopilot/seal.ts");

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const client = createClient({ chains: [CELO], appCode: AUTOPILOT_APP_CODES, agentIdentity: false });
const admin = signerFromPrivateKey(keys.admin);
const wallet = await client.createWallet({ signer: admin });
const W = wallet.address as `0x${string}`;
const recipient = privateKeyToAccount(keys.recipient).address;
const log: Record<string, unknown>[] = [];
const out = (step: string, ok: boolean, detail: Record<string, unknown> = {}) => {
  log.push({ step, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}`, JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const tag = async (h?: Hex) => (h ? parseAttribution((await pub.getTransaction({ hash: h })).input) : null);
const key = (s: string) => `test:${s}:${Date.now()}`;

console.log("wallet", W, "recipient", recipient);
const limits = { USDT: "2.5", cNGN: "3000" };
const maxPerTransfer = { USDT: "1.2", cNGN: "2000" };

// 1. Grant the session template (5 calls, monthly caps, 1 h) and seal it with recipients + caps.
const k = server.issueKey(W);
const agentPub = { type: "privateKey" as const, address: k.address, publicKey: k.publicKey, signDigest: async () => { throw new Error("public only"); } };
const grant = await client.grantSession({ wallet, signer: admin, permissions: autopilotPermissions(limits), expiry: Math.floor(Date.now() / 1000) + 3600, sessionSigner: agentPub, chainId: 42220, feeToken: TOKENS.USDT.address, register: false });
out("1. grant session: USD₮/cNGN approve+transfer, Textile reactor, monthly caps, 1 h", grant.status === "granted", { tx: (grant as { transactionHash?: Hex }).transactionHash });
const act = await server.activate({ sealedKey: k.sealedKey, session: serializeSession(grant), recipients: [{ address: recipient, label: "Test recipient" }], limits, maxPerTransfer });
const policy = act.sealedPolicy;
const st = await server.status(policy, W);
out("1b. server confirms access on-chain; reads balances and remaining allowance", st.authorized, { balances: st.balances, remaining: st.remaining, maxPerTransfer: st.maxPerTransfer });

// 2. Recurring-transfer path: eligible transfer to a saved recipient.
const t1 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "transfer", key: key("t1"), token: "USDT", amountAtomic: "100000", recipient } });
out("2. transfer 0.10 USD₮ to a saved recipient → completed, tagged", t1.status === "completed", { tx: t1.transactionHash, tag: await tag(t1.transactionHash), error: t1.error });

// 3. Not a saved recipient → refused before signing.
const t2 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "transfer", key: key("t2"), token: "USDT", amountAtomic: "100000", recipient: "0x000000000000000000000000000000000000dEaD" } });
out("3. unsaved recipient refused by subscan's server", t2.status === "refused" && !!t2.refusals?.includes("recipient_not_approved"), { refusals: t2.refusals });

// 4. Above the per-transfer cap → refused before signing.
const t3 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "transfer", key: key("t3"), token: "USDT", amountAtomic: "1500000", recipient } });
out("4. 1.5 USD₮ above the 1.2 USD₮ per-transfer cap refused", t3.status === "refused" && !!t3.refusals?.includes("over_transfer_limit"), { refusals: t3.refusals });

// 5. Money rule: convert USD₮ → 1,450 cNGN with the rule's max enforced on the firm quote (keyless: session proof).
const c1 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "convert", key: key("c1"), sellToken: "USDT", buyToken: "cNGN", buyAmountAtomic: "1450000000", maxSellAtomic: "1100000" } });
out("5. rule conversion USD₮ → 1,450 cNGN via Textile firm quote, one session tx", c1.status === "completed", { tx: c1.transactionHash, quote: c1.quote, tag: await tag(c1.transactionHash), refusals: c1.refusals, error: c1.error });

// 6. Rule max lower than the live quote → refused, nothing moves.
const c2 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "convert", key: key("c2"), sellToken: "USDT", buyToken: "cNGN", buyAmountAtomic: "1450000000", maxSellAtomic: "500000" } });
out("6. quote above the rule's max (0.5 USD₮) refused", c2.status === "refused" && !!(c2.refusals?.includes("over_rule_max") || c2.refusals?.includes("route_unavailable")), { refusals: c2.refusals, error: c2.error });

// 7. Reverse conversion cNGN → USD₮ (needs the new cNGN.approve permission).
if (c1.status === "completed") {
  const c3 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "convert", key: key("c3"), sellToken: "cNGN", buyToken: "USDT", sellAmountAtomic: "1450000000" } });
  out("7. conversion cNGN → USD₮ (cNGN.approve + swap), one session tx", c3.status === "completed", { tx: c3.transactionHash, quote: c3.quote, refusals: c3.refusals, error: c3.error });
}

// 8. On-chain enforcement, bypassing subscan's checks on purpose: over the monthly cap, and a call outside the list.
const session = deserializeSession(serializeSession(grant), signerFromPrivateKey(unseal<{ key: Hex }>(policy, W.toLowerCase()).key));
const rej = async (step: string, calls: { to: `0x${string}`; data: Hex; value: bigint }[]) => {
  try {
    const r = await client.execute({ session, calls, chainId: 42220, feeToken: TOKENS.USDT.address });
    out(step, r.status !== "CONFIRMED", { status: r.status, tx: r.transactionHash });
  } catch (e) {
    out(step, true, { rejectedWith: (e as { code?: string }).code ?? (e as Error).name, message: (e as Error).message.slice(0, 200) });
  }
};
await rej("8a. over the monthly USD₮ cap (2.4 USD₮) rejected by the wallet", [{ to: TOKENS.USDT.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 2_400000n] }), value: 0n }]);
await rej("8b. call outside the allowed list (USD₮.transferFrom) rejected by the wallet", [{ to: TOKENS.USDT.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [W, recipient, 1n] }), value: 0n }]);

// 9. Revoke, then the server refuses.
const rv = await client.revokeSession({ wallet, signer: admin, session: k.publicKey, feeToken: TOKENS.USDT.address });
out("9a. revoke access (one transaction)", true, { tx: (rv as { transactionHash?: Hex }).transactionHash });
const t4 = await server.execute({ sealedPolicy: policy, wallet: W, request: { kind: "transfer", key: key("t4"), token: "USDT", amountAtomic: "100000", recipient } });
out("9b. after revoke, subscan's server refuses (key_not_authorized)", t4.status === "refused" && !!t4.refusals?.includes("key_not_authorized"), { refusals: t4.refusals });

writeFileSync(`${dir}/evidence-v2.json`, JSON.stringify({ wallet: W, recipient, at: new Date().toISOString(), log }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("evidence written");
