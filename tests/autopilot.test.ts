import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { checkConversion, checkTransfer, type CheckContext } from "../src/lib/payments/engine.ts";
import { autopilotPermissions } from "../src/lib/autopilot/permissions.ts";
import { seal, unseal } from "../src/lib/autopilot/seal.ts";
import { TEXTILE, TOKENS } from "../src/lib/celo/config.ts";

const R = "0x1111111111111111111111111111111111111111" as const;
const saved = [{ address: R, label: "Mum" }];
const ok: CheckContext = {
  now: 1_000,
  expiry: 2_000,
  keyAuthorized: true,
  maxPerTransfer: { cNGN: 10_000_000000n },
  remaining: { USDT: 50_000000n, cNGN: 30_000_000000n },
  balances: { USDT: 40_000000n, cNGN: 20_000_000000n },
  alreadyDone: false,
};
const tx = { token: "cNGN" as const, amount: 5_000_000000n, recipient: R };

test("an eligible transfer passes every check", () => assert.deepEqual(checkTransfer(tx, saved, ok), []));
test("a recipient that isn't saved is refused", () => assert.deepEqual(checkTransfer({ ...tx, recipient: "0x2222222222222222222222222222222222222222" }, saved, ok), ["recipient_not_approved"]));
test("above the per-transfer cap is refused", () => assert.deepEqual(checkTransfer({ ...tx, amount: 12_000_000000n }, saved, ok), ["over_transfer_limit"]));
test("over the monthly limit, expired, unauthorised, no funds, duplicate", () => {
  assert.deepEqual(checkTransfer(tx, saved, { ...ok, remaining: { ...ok.remaining, cNGN: 1n } }), ["over_monthly_limit"]);
  assert.deepEqual(checkTransfer(tx, saved, { ...ok, now: 2_000 }), ["access_expired"]);
  assert.deepEqual(checkTransfer(tx, saved, { ...ok, keyAuthorized: false }), ["key_not_authorized"]);
  assert.deepEqual(checkTransfer(tx, saved, { ...ok, balances: { ...ok.balances, cNGN: 0n } }), ["insufficient_funds"]);
  assert.deepEqual(checkTransfer(tx, saved, { ...ok, alreadyDone: true }), ["already_done"]);
});
test("several problems are all reported", () => {
  const r = checkTransfer({ ...tx, recipient: "0x2222222222222222222222222222222222222222", amount: 0n }, saved, { ...ok, now: 5_000 });
  assert.deepEqual(r.sort(), ["access_expired", "invalid_amount", "recipient_not_approved"]);
});
test("conversions: no route, old access, cap on the sold token", () => {
  assert.deepEqual(checkConversion({ sellToken: "USDT", sellAmount: 5_000000n, routeOk: true, templateOk: true }, ok), []);
  assert.deepEqual(checkConversion({ sellToken: "USDT", sellAmount: 5_000000n, routeOk: false, templateOk: true }, ok), ["route_unavailable"]);
  assert.deepEqual(checkConversion({ sellToken: "cNGN", sellAmount: 5_000_000000n, routeOk: true, templateOk: false }, ok), ["needs_renewal"]);
  assert.deepEqual(checkConversion({ sellToken: "cNGN", sellAmount: 15_000_000000n, routeOk: true, templateOk: true }, ok), ["over_transfer_limit"]);
});

test("session template: only the five allowed calls and monthly caps in token units", () => {
  const p = autopilotPermissions({ USDT: "25", cNGN: "40000" });
  assert.deepEqual(p.calls.map((c) => ("signature" in c ? `${c.to}:${c.signature}` : c.to)), [
    `${TOKENS.USDT.address}:approve(address,uint256)`,
    `${TOKENS.USDT.address}:transfer(address,uint256)`,
    `${TOKENS.cNGN.address}:approve(address,uint256)`,
    `${TOKENS.cNGN.address}:transfer(address,uint256)`,
    TEXTILE.reactor,
  ]);
  assert.deepEqual(p.spend.map((s) => [s.token, s.limit, s.period]), [
    [TOKENS.USDT.address, 25_000000n, "month"],
    [TOKENS.cNGN.address, 40_000_000000n, "month"],
  ]);
});

test("sealed agent key opens only with the right secret and wallet", () => {
  process.env.AUTOPILOT_SEAL_KEY = randomBytes(32).toString("hex");
  const s = seal({ key: "0xabc" }, "0xwallet");
  assert.deepEqual(unseal(s, "0xwallet"), { key: "0xabc" });
  assert.throws(() => unseal(s, "0xother"), /another wallet/);
  process.env.AUTOPILOT_SEAL_KEY = randomBytes(32).toString("hex");
  assert.throws(() => unseal(s, "0xwallet"));
});

test("a long passphrase works as the seal secret; a short one is refused", () => {
  process.env.AUTOPILOT_SEAL_KEY = "correct horse battery staple violet river 42";
  assert.deepEqual(unseal(seal({ ok: 1 }, "w"), "w"), { ok: 1 });
  process.env.AUTOPILOT_SEAL_KEY = "too short";
  assert.throws(() => seal({}, "w"), /at least 32 characters/);
});
