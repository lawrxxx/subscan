import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { checkAutopay, type AutopayContext, type AutopayRequest } from "../src/lib/payments/engine.ts";
import { autopilotPermissions } from "../src/lib/autopilot/permissions.ts";
import { seal, unseal } from "../src/lib/autopilot/seal.ts";
import { TEXTILE, TOKENS } from "../src/lib/celo/config.ts";

const R = "0x1111111111111111111111111111111111111111" as const;
const req: AutopayRequest = { billId: "b1", billName: "Rent", recipient: R, token: "cNGN", amountAtomic: 5_000_000000n, dueDate: "2026-12-01" };
const ok: AutopayContext = {
  now: 1_000,
  enabled: true,
  expiry: 2_000,
  revoked: false,
  keyAuthorized: true,
  recipients: [{ address: R, label: "Landlord" }],
  remaining: { USDT: 50_000000n, cNGN: 10_000_000000n },
  balances: { USDT: 40_000000n, cNGN: 0n },
  source: "USDT",
  sourceNeeded: 3_500000n,
  conversionAvailable: true,
  alreadyPaid: false,
};

test("eligible payment passes every check", () => assert.deepEqual(checkAutopay(req, ok), []));
test("over the monthly limit is refused", () => assert.deepEqual(checkAutopay(req, { ...ok, remaining: { ...ok.remaining, USDT: 1_000000n } }), ["over_limit"]));
test("unapproved recipient is refused", () => assert.deepEqual(checkAutopay({ ...req, recipient: "0x2222222222222222222222222222222222222222" }, ok), ["recipient_not_approved"]));
test("expired access is refused", () => assert.deepEqual(checkAutopay(req, { ...ok, now: 2_000 }), ["access_expired"]));
test("revoked or unauthorised key is refused", () => {
  assert.deepEqual(checkAutopay(req, { ...ok, revoked: true }), ["access_revoked"]);
  assert.deepEqual(checkAutopay(req, { ...ok, keyAuthorized: false }), ["key_not_authorized"]);
});
test("no conversion route, not enough money, already paid, autopilot off", () => {
  assert.deepEqual(checkAutopay(req, { ...ok, conversionAvailable: false }), ["route_unavailable"]);
  assert.deepEqual(checkAutopay(req, { ...ok, balances: { USDT: 1n, cNGN: 0n } }), ["insufficient_funds"]);
  assert.deepEqual(checkAutopay(req, { ...ok, alreadyPaid: true }), ["already_paid"]);
  assert.deepEqual(checkAutopay(req, { ...ok, enabled: false }), ["autopilot_off"]);
});
test("several problems are all reported", () => {
  const r = checkAutopay({ ...req, recipient: "0x2222222222222222222222222222222222222222" }, { ...ok, now: 5_000, balances: { USDT: 0n, cNGN: 0n } });
  assert.deepEqual(r.sort(), ["access_expired", "insufficient_funds", "recipient_not_approved"]);
});

test("session template: only the four allowed calls and monthly caps in token units", () => {
  const p = autopilotPermissions({ USDT: "25", cNGN: "40000" });
  assert.deepEqual(p.calls.map((c) => ("signature" in c ? `${c.to}:${c.signature}` : c.to)), [
    `${TOKENS.USDT.address}:approve(address,uint256)`,
    `${TOKENS.USDT.address}:transfer(address,uint256)`,
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
