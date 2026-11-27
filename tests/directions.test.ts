// Money in / money out across representative statement layouts, built as positioned
// text lines the way pdf.js reports them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementLines, type TextLine } from "../src/lib/import/pdf-lines.ts";
import { extractCsv } from "../src/lib/import/csv.ts";
import { flagInFileRepeats } from "../src/lib/import/normalise.ts";
import { ISSUE } from "../src/lib/import/types.ts";

let y = 800;
/** One text line from [text, x] pairs (width ≈ 5pt per character). */
const L = (...cells: [string, number][]): TextLine => ({ page: 1, y: (y -= 14), items: cells.map(([str, x]) => ({ str, x, w: str.length * 5 })) });
const dirs = (rows: { direction: string }[]) => rows.map((r) => r.direction);

test("separate debit and credit columns, headings with currency: inward transfers are money in", () => {
  y = 800;
  const { rows, layout } = parseStatementLines(
    [
      L(["Trans Date", 40], ["Narration", 120], ["Debit (₦)", 330], ["Credit (₦)", 410], ["Balance (₦)", 490]),
      L(["01-Oct-2026", 40], ["Opening Balance", 120], ["100,000.00", 490]),
      L(["02-Oct-2026", 40], ["NIP TRF FROM ADA OBI", 120], ["50,000.00", 410], ["150,000.00", 490]),
      L(["03-Oct-2026", 40], ["POS PURCHASE SHOPRITE", 120], ["12,500.00", 330], ["137,500.00", 490]),
      L(["04-Oct-2026", 40], ["TRANSFER FROM SAVINGS", 120], ["20,000.00", 410], ["157,500.00", 490]),
      L(["05-Oct-2026", 40], ["WEB PAYMENT NETFLIX.COM", 120], ["5,000.00", 330], ["152,500.00", 490]),
    ],
    "NGN",
  );
  assert.equal(layout, "separate money in and money out columns");
  assert.deepEqual(dirs(rows), ["credit", "debit", "credit", "debit"]);
  assert.ok(rows.every((r) => r.issues.length === 0));
});

test("merged cells that place a credit near the debit column are corrected by the running balance", () => {
  y = 800;
  const { rows } = parseStatementLines(
    [
      L(["Date", 40], ["Description", 120], ["Debit", 300], ["Credit", 380], ["Balance", 470]),
      L(["01/10/2026", 40], ["Balance brought forward", 120], ["10,000.00", 470]),
      // Whole row in one text run: the credit's estimated position lands nearer "Debit".
      L(["02/10/2026", 40], ["INWARD TRANSFER FROM JOHN DOE PAYMENT 25,000.00 35,000.00", 120]),
      L(["03/10/2026", 40], ["AIRTIME MTN 1,000.00 34,000.00", 120]),
    ],
    "NGN",
  );
  assert.deepEqual(dirs(rows), ["credit", "debit"]);
  assert.equal(rows[0].directionFrom, "balance");
  assert.equal(rows[0].amount, 25000);
  assert.equal(rows[0].balance, 35000);
});

test("single signed amount column: minus is money out, unmarked positive is money in", () => {
  y = 800;
  const { rows, layout } = parseStatementLines(
    [
      L(["Date", 40], ["Description", 120], ["Amount", 400]),
      L(["2026-10-02", 40], ["Salary ACME LTD", 120], ["850,000.00", 400]),
      L(["2026-10-03", 40], ["Card payment UBER", 120], ["-2,400.00", 400]),
      L(["2026-10-04", 40], ["Refund JUMIA", 120], ["+3,100.00", 400]),
      L(["2026-10-05", 40], ["Bolt ride", 120], ["(1,800.00)", 400]),
    ],
    "NGN",
  );
  assert.equal(layout, "single amount column");
  assert.deepEqual(dirs(rows), ["credit", "debit", "credit", "debit"]);
  assert.deepEqual(rows.map((r) => r.amount), [850000, 2400, 3100, 1800]);
  assert.ok(rows.every((r) => r.issues.length === 0));
});

test("CR/DR markers, attached or in their own column", () => {
  y = 800;
  const { rows } = parseStatementLines(
    [
      L(["05 Oct 2026", 40], ["TRANSFER FROM KEMI", 120], ["40,000.00", 380], ["CR", 440]),
      L(["06 Oct 2026", 40], ["DSTV SUBSCRIPTION", 120], ["19,000.00 DR", 380]),
    ],
    "NGN",
  );
  assert.deepEqual(dirs(rows), ["credit", "debit"]);
  assert.ok(!rows[0].description.includes("CR"), "marker isn't part of the description");
});

test("no direction information at all: flagged, never silently money out, with a suggestion only", () => {
  y = 800;
  const { rows } = parseStatementLines(
    [
      L(["05/10/2026", 40], ["NIP TRANSFER FROM IFEOMA", 120], ["15,000.00", 400]),
      L(["06/10/2026", 40], ["POS SPAR LEKKI", 120], ["8,000.00", 400]),
    ],
    "NGN",
  );
  for (const r of rows) {
    assert.deepEqual(r.issues, [ISSUE.direction]);
    assert.equal(r.include, false);
    assert.equal(r.directionFrom, undefined);
  }
  assert.equal(rows[0].hint, "credit");
  assert.equal(rows[1].hint, "debit");
});

test("totals reconcile with the running balance", () => {
  y = 800;
  const { rows } = parseStatementLines(
    [
      L(["Date", 40], ["Narration", 120], ["Withdrawals", 300], ["Lodgements", 380], ["Balance", 470]),
      L(["01/10/2026", 40], ["Opening balance", 120], ["5,000.00", 470]),
      L(["02/10/2026", 40], ["SALARY OCT", 120], ["300,000.00", 380], ["305,000.00", 470]),
      L(["03/10/2026", 40], ["RENT TO LANDLORD", 120], ["250,000.00", 300], ["55,000.00", 470]),
      L(["04/10/2026", 40], ["ATM WITHDRAWAL", 120], ["20,000.00", 300], ["35,000.00", 470]),
      L(["05/10/2026", 40], ["REVERSAL ATM", 120], ["20,000.00", 380], ["55,000.00", 470]),
    ],
    "NGN",
  );
  const net = rows.reduce((x, r) => x + (r.direction === "credit" ? r.amount : -r.amount), 0);
  assert.equal(5000 + net, rows[rows.length - 1].balance);
  assert.equal(rows.filter((r) => r.direction === "credit").length, 2);
});

test("identical rows in one file: first kept, repeat flagged for a decision", () => {
  const rows = flagInFileRepeats([
    { id: "a", date: "2026-10-02", description: "CAFE NEO", amount: 3000, direction: "debit", currency: "NGN", issues: [], include: true },
    { id: "b", date: "2026-10-02", description: "CAFE NEO", amount: 3000, direction: "debit", currency: "NGN", issues: [], include: true },
  ]);
  assert.equal(rows[0].include, true);
  assert.deepEqual(rows[1].issues, [ISSUE.repeat]);
  assert.equal(rows[1].include, false);
});

test("CSV: type column, explicit plus sign, trailing minus and separate columns", () => {
  const typed = extractCsv("Date,Description,Amount,Type\n2026-10-02,TRANSFER FROM ADA,5000,CR\n2026-10-03,NETFLIX,5000,DR", "NGN");
  assert.deepEqual(dirs(typed.rows), ["credit", "debit"]);
  const plus = extractCsv("Date,Description,Amount\n2026-10-02,Refund,+3100\n2026-10-03,Uber,2400", "NGN");
  assert.equal(plus.rows[0].direction, "credit");
  assert.deepEqual(plus.rows[1].issues, [ISSUE.direction], "unsigned row without other negatives stays unsure");
  const trailing = extractCsv("Date,Description,Amount\n2026-10-02,Salary,850000.00\n2026-10-03,Uber,2400.00-", "NGN");
  assert.deepEqual(dirs(trailing.rows), ["credit", "debit"]);
  const cols = extractCsv("Date,Narration,Money Out,Money In\n2026-10-02,TRF FROM ADA,,5000\n2026-10-03,POS,1200,", "NGN");
  assert.deepEqual(dirs(cols.rows), ["credit", "debit"]);
});
