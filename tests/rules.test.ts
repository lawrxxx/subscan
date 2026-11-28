import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, notices } from "../src/lib/agent/rules.ts";
import type { AppState, Subscription } from "../src/lib/types.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-12-10T12:00:00Z");
const iso = (d: number) => new Date(now + d * DAY).toISOString().slice(0, 10);
const R = "0x1111111111111111111111111111111111111111" as const;
const W = "0x2222222222222222222222222222222222222222" as const;

function bill(over: Partial<Subscription> = {}): Subscription {
  // Three monthly payments → regular, so a next date is predicted.
  return {
    id: "rent", merchant: "rent", displayName: "Rent", category: "Rent", kind: "obligation", amount: 5000, currency: "NGN", frequency: "monthly", intervalDays: 30,
    lastCharge: iso(-29), nextRenewal: iso(1), firstSeen: iso(-89), chargeCount: 3, totalSpent: 15000,
    history: [{ date: iso(-89), amount: 5000 }, { date: iso(-59), amount: 5000 }, { date: iso(-29), amount: 5000 }],
    confidence: 0.95, confidenceReasons: [], status: "confirmed", international: false, autopay: true,
    payment: { method: "address", address: R, token: "cNGN" }, ...over,
  };
}
function state(over: Partial<AppState> = {}, sub = bill()): AppState {
  return {
    transactions: [], subscriptions: [sub], payments: [], settings: { homeCurrency: "NGN", payGasInUsdt: false },
    autopilot: { wallet: W, enabled: true, sealedPolicy: "sealed", limits: { USDT: "20", cNGN: "30000" }, recipients: [{ address: R, label: "Landlord" }], expiry: now / 1000 + 30 * 86400 },
    ...over,
  };
}
const one = (s: AppState) => decide(s, now)[0];

test("due, approved, within limit, on → pay", () => assert.equal(one(state()).decision, "pay"));
test("not due yet → scheduled", () => assert.equal(one(state({}, bill({ nextRenewal: iso(10) }))).decision, "scheduled"));
test("no Autopilot → needs you, set up", () => {
  const d = one(state({ autopilot: undefined }));
  assert.equal(d.decision, "needs_you");
  assert.equal(d.action?.href, "/autopilot");
});
test("recipient not approved → needs you", () => assert.match(one(state({ autopilot: { ...state().autopilot!, recipients: [] } })).reasons.join(), /approved list/));
test("expired or revoked access → needs you", () => {
  assert.match(one(state({ autopilot: { ...state().autopilot!, expiry: now / 1000 - 1 } })).reasons.join(), /expired/);
  assert.match(one(state({ autopilot: { ...state().autopilot!, revokedAt: iso(-1) } })).reasons.join(), /revoked/);
});
test("Auto off → needs you; paused → blocked; over limit → blocked", () => {
  assert.equal(one(state({}, bill({ autopay: false }))).decision, "needs_you");
  assert.equal(one(state({ autopilot: { ...state().autopilot!, enabled: false } })).decision, "blocked");
  assert.match(one(state({ autopilot: { ...state().autopilot!, limits: { USDT: "20", cNGN: "1000" } } })).reasons.join(), /monthly cNGN limit/);
});
test("already paid for this due date → paid", () => {
  const s = state({ payments: [{ id: "p", createdAt: iso(0), subscriptionId: "rent", merchant: "Rent", sourceToken: "cNGN", destinationToken: "cNGN", sourceAmount: "5000", destinationAmount: "5000", method: "address", steps: [], status: "confirmed", idempotencyKey: `${W.toLowerCase()}|rent|${iso(1)}` }] });
  assert.equal(one(s).decision, "paid");
});
test("no wallet address → you pay it yourself; two payments only → no date", () => {
  assert.equal(one(state({}, bill({ payment: undefined }))).decision, "manual");
  assert.equal(one(state({}, bill({ history: bill().history.slice(1), chargeCount: 2 }))).decision, "no_date");
});
test("long overdue → needs you, never auto-paid", () => assert.equal(one(state({}, bill({ nextRenewal: iso(-20), history: [{ date: iso(-110), amount: 5000 }, { date: iso(-80), amount: 5000 }, { date: iso(-50), amount: 5000 }] }))).decision, "needs_you"));
test("notices only within a week and only needs-you/blocked", () => {
  assert.equal(notices(decide(state({ autopilot: undefined }), now)).length, 1);
  assert.equal(notices(decide(state({ autopilot: undefined }, bill({ nextRenewal: iso(20) })), now)).length, 0);
  assert.equal(notices(decide(state(), now)).length, 0);
});
