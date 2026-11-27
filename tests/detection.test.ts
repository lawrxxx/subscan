import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTransactionsCsv, parseDate, parseAmount } from "../src/lib/detection/csv.ts";
import { detectSubscriptions, addPeriod } from "../src/lib/detection/engine.ts";
import { spendSummary, duplicates, upcomingRenewals, wasteCandidates } from "../src/lib/detection/analysis.ts";
import { sampleStatementCsv } from "./fixtures/sample-statement.ts";

const TODAY = "2026-11-26";

test("parses amounts and dates", () => {
  assert.deepEqual(parseAmount("₦4,400.00"), { value: 4400, currency: "NGN" });
  assert.equal(parseAmount("-1,200.50")?.value, -1200.5);
  assert.equal(parseAmount("(300)")?.value, -300);
  assert.equal(parseDate("03/11/2026", "dmy"), "2026-11-03");
  assert.equal(parseDate("12-Jan-2026", "text"), "2026-01-12");
  assert.equal(parseDate("Jan 12, 2026", "text"), "2026-01-12");
});

test("addPeriod keeps day of month and clamps", () => {
  assert.equal(addPeriod("2026-01-31", "monthly", 30), "2026-02-28");
  assert.equal(addPeriod("2026-03-15", "yearly", 365), "2027-03-15");
});

test("signed single-amount column treats negatives as debits", () => {
  const csv = [
    "Date,Description,Amount",
    "2026-08-03,NETFLIX.COM,-4400",
    "2026-09-03,NETFLIX.COM,-4400",
    "2026-10-03,NETFLIX.COM,-4400",
    "2026-10-05,SALARY,500000",
  ].join("\n");
  const r = parseTransactionsCsv(csv);
  assert.equal(r.transactions.length, 3);
  const subs = detectSubscriptions(r.transactions, { today: TODAY });
  assert.equal(subs.length, 1);
  assert.equal(subs[0].displayName, "Netflix");
  assert.equal(subs[0].frequency, "monthly");
  assert.equal(subs[0].nextRenewal, "2026-12-03");
});

test("detects the sample statement accurately", () => {
  const csv = sampleStatementCsv(new Date(`${TODAY}T12:00:00Z`));
  const { transactions } = parseTransactionsCsv(csv, "NGN", "sample");
  const subs = detectSubscriptions(transactions, { today: TODAY, homeCurrency: "NGN" });
  const names = subs.map((s) => s.displayName).sort();
  for (const n of ["Netflix", "Spotify", "DStv", "MTN Data Plan", "ChatGPT Plus", "Notion", "Apple Services", "YouTube Premium", "Showmax", "Audiomack"])
    assert.ok(names.includes(n), `missing ${n}: ${names.join(", ")}`);
  // grocery / transport noise must not become subscriptions
  assert.ok(!names.some((n) => /shoprite|bolt|uber|jumia/i.test(n)), names.join(", "));
  const netflix = subs.find((s) => s.displayName === "Netflix")!;
  assert.equal(netflix.amount, 5000);
  assert.ok(netflix.priceChange && netflix.priceChange.from === 4400);
  const canva = subs.find((s) => s.displayName === "Canva");
  assert.ok(canva && canva.frequency === "yearly", "annual canva");
  const chat = subs.find((s) => s.displayName === "ChatGPT Plus")!;
  assert.equal(chat.international, true);

  const sum = spendSummary(subs, "NGN", {});
  assert.equal(sum.monthlyHome, null);
  assert.deepEqual(sum.unconverted, ["USD"]);
  const conv = spendSummary(subs, "NGN", { USD: 1450 });
  assert.ok(conv.monthlyHome! > 0);
  assert.ok(duplicates(subs).length >= 1);
  assert.ok(upcomingRenewals(subs, TODAY, 31).length > 0);
  assert.ok(wasteCandidates(subs, "NGN", { USD: 1450 }, TODAY).length > 0);
});
