import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSubscriptions } from "../src/lib/detection/engine.ts";
import { bulkEligible, displayLabel, explain, frequencyText, level, predictedNext } from "../src/lib/review.ts";
import type { Transaction } from "../src/lib/types.ts";

const today = "2026-11-27";
const tx = (date: string, description: string, amount: number, i: number): Transaction => ({ id: `t${i}-${date}`, date, description, merchant: "", amount, currency: "NGN", direction: "debit", source: "csv" });
let n = 0;
function detect(rows: [string, string, number][]) {
  const txs = rows.map(([d, desc, a]) => tx(d, desc, a, n++));
  // merchant keys are assigned by detection's own normalisation
  return detectSubscriptions(txs, { homeCurrency: "NGN", today });
}
const fmt = (x: number) => `NGN ${x}`;

test("four steady monthly Netflix charges: likely recurring, monthly, next date shown, bulk-eligible", () => {
  const [s] = detect([["2026-08-03", "NETFLIX.COM", 5000], ["2026-09-03", "NETFLIX.COM", 5000], ["2026-10-03", "NETFLIX.COM", 5000], ["2026-11-03", "NETFLIX.COM", 5000]]);
  assert.ok(s, "detected");
  assert.equal(level(s), "likely");
  assert.equal(frequencyText(s), "About once a month");
  assert.ok(predictedNext(s));
  assert.ok(bulkEligible(s));
  assert.match(explain(s, fmt), /4 payments, about once a month, NGN 5000 each time/);
});

test("two payments are never 'likely' and never claim a frequency or next date", () => {
  const subs = detect([["2026-09-10", "NETFLIX.COM", 5000], ["2026-10-10", "NETFLIX.COM", 5000]]);
  for (const s of subs) {
    assert.notEqual(level(s), "likely");
    assert.equal(frequencyText(s), null);
    assert.equal(predictedNext(s), null);
    assert.equal(bulkEligible(s), false);
    assert.match(explain(s, fmt), /2 identical payments 30 days apart\. Two payments aren't enough/);
  }
});

test("reference-number labels become 'Unknown merchant' with the original text kept", () => {
  const base = { id: "x", merchant: "x", category: "Other", amount: 1, currency: "NGN", frequency: "monthly" as const, intervalDays: 30, lastCharge: today, nextRenewal: today, firstSeen: today, chargeCount: 2, totalSpent: 2, history: [], confidence: 0.7, confidenceReasons: [], status: "detected" as const, international: false };
  assert.deepEqual(displayLabel({ ...base, displayName: "0098765432 Ft23109" }, "TRF 0098765432 FT23109ABCD"), { name: "Unknown merchant", unknown: true, detail: "TRF 0098765432 FT23109ABCD" });
  assert.equal(displayLabel({ ...base, displayName: "Trf Adebayo" }, "TRF ADEBAYO").name, "Unknown merchant");
  assert.equal(displayLabel({ ...base, displayName: "Netflix" }, "NETFLIX.COM").name, "Netflix");
  assert.equal(displayLabel({ ...base, displayName: "0098765432 Ft23109", edited: true }).name, "0098765432 Ft23109");
});
