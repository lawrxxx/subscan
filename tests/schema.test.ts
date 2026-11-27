import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportIn, PaymentIn, ProfilePatch, SubscriptionPatch } from "../src/lib/db/schema.ts";
import { paymentToRow, rowToPayment, rowToSub, subToRow } from "../src/lib/db/repo.ts";
import { detectSubscriptions } from "../src/lib/detection/engine.ts";
import { parseTransactionsCsv } from "../src/lib/detection/csv.ts";
import { sampleStatementCsv } from "../src/lib/sample.ts";

test("subscription patch is strict and validated", () => {
  assert.ok(SubscriptionPatch.safeParse({ status: "confirmed" }).success);
  assert.ok(!SubscriptionPatch.safeParse({ status: "paid" }).success);
  assert.ok(!SubscriptionPatch.safeParse({ user_id: "x" }).success, "unknown keys rejected");
  assert.ok(!SubscriptionPatch.safeParse({ payment: { method: "address", token: "USDT" } }).success, "address required");
  assert.ok(!SubscriptionPatch.safeParse({ payment: { method: "x402", token: "USDT", x402Url: "http://insecure.example" } }).success, "https only");
  assert.ok(SubscriptionPatch.safeParse({ payment: { method: "address", token: "cNGN", address: "0x000000000000000000000000000000000000dEaD" } }).success);
});

test("payment and profile validation", () => {
  const base = { id: "pay_abc123", createdAt: new Date().toISOString(), subscriptionId: "netflix", merchant: "Netflix", sourceToken: "USDT", destinationToken: "cNGN", sourceAmount: "3.4", destinationAmount: "5000", method: "address", status: "prepared", steps: [{ kind: "settlement", label: "x", status: "prepared" }] };
  assert.ok(PaymentIn.safeParse(base).success);
  assert.ok(!PaymentIn.safeParse({ ...base, sourceToken: "DAI" }).success);
  assert.ok(!PaymentIn.safeParse({ ...base, steps: [{ kind: "settlement", label: "x", status: "confirmed", hash: "0x123" }] }).success, "bad hash");
  assert.ok(!ProfilePatch.safeParse({ wallet: "0xnope" }).success);
  assert.ok(ProfilePatch.safeParse({ homeCurrency: "USD", wallet: null }).success);
});

test("import payload bounds", () => {
  assert.ok(!ImportIn.safeParse({ source: "csv", transactions: [] }).success);
  assert.ok(!ImportIn.safeParse({ source: "mono", transactions: [{ id: "1", date: "2026-01-01", description: "x", merchant: "x", amount: 1, currency: "NGN", source: "csv" }] }).success, "clients cannot claim mono");
});

test("row mappers round-trip", () => {
  const { transactions } = parseTransactionsCsv(sampleStatementCsv(new Date("2026-11-26T12:00:00Z")), "NGN", "sample");
  const [sub] = detectSubscriptions(transactions, { today: "2026-11-26" });
  const back = rowToSub(subToRow(sub, "u1"));
  for (const k of ["id", "displayName", "amount", "currency", "frequency", "nextRenewal", "status", "chargeCount"] as const) assert.equal(back[k], sub[k]);
  const p = { id: "pay_x1y2", createdAt: "2026-11-27T00:00:00Z", subscriptionId: "s", merchant: "M", sourceToken: "USDT" as const, destinationToken: "cNGN" as const, sourceAmount: "1", destinationAmount: "1400", method: "address" as const, steps: [], status: "prepared" as const };
  assert.deepEqual(rowToPayment(paymentToRow(p, "u1")), { ...p, feeAmount: undefined, rate: undefined, recipient: undefined, from: undefined, rfqId: undefined });
});
