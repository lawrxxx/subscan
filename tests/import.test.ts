import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { linesFromItems, parseStatementLines, type TextLine } from "../src/lib/import/pdf-lines.ts";
import { extractCsv } from "../src/lib/import/csv.ts";
import { markDuplicates, mergeTransactions, rowsToTransactions } from "../src/lib/import/normalise.ts";
import { detectSubscriptions } from "../src/lib/detection/engine.ts";
import { income } from "../src/lib/detection/analysis.ts";

async function pdfLines(path: string): Promise<TextLine[]> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false }).promise;
  const lines: TextLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    lines.push(...linesFromItems(p, c.items as { str: string; transform: number[]; width: number }[]));
  }
  return lines;
}

test("PDF with debit/credit columns: every row read, directions from columns", async () => {
  const { rows, layout } = parseStatementLines(await pdfLines("tests/fixtures/statement-columns.pdf"), "NGN");
  assert.equal(layout, "column layout");
  assert.equal(rows.length, 54);
  assert.equal(rows.filter((r) => r.issues.length).length, 0, JSON.stringify(rows.filter((r) => r.issues.length).slice(0, 3)));
  assert.equal(rows.filter((r) => r.direction === "credit").length, 6);
  const ikedc = rows.find((r) => r.description.startsWith("IKEDC"))!;
  assert.match(ikedc.description, /TOKEN 1234-5678/, "multi-line narration joined");
  assert.ok(!/Opening|Closing/.test(rows.map((r) => r.description).join()), "balance lines skipped");
  const netflix = rows.find((r) => r.description.startsWith("NETFLIX"))!;
  assert.deepEqual([netflix.date, netflix.amount, netflix.direction], ["2026-06-03", 5000, "debit"]);
});

test("PDF with single amount + running balance: direction inferred from balance", async () => {
  const { rows } = parseStatementLines(await pdfLines("tests/fixtures/statement-balance.pdf"), "NGN");
  assert.equal(rows.length, 54);
  assert.equal(rows.filter((r) => r.issues.length).length, 0);
  assert.equal(rows.filter((r) => r.direction === "credit").length, 6);
  assert.equal(rows.find((r) => r.description.startsWith("SALARY"))!.direction, "credit");
});

test("scanned PDF has no text to parse", async () => {
  const lines = await pdfLines("tests/fixtures/statement-scanned.pdf");
  assert.equal(lines.length, 0);
});

test("PDF rows → bills, income and payday", async () => {
  const { rows } = parseStatementLines(await pdfLines("tests/fixtures/statement-columns.pdf"), "NGN");
  const txs = rowsToTransactions(rows, "pdf", "imp1");
  const subs = detectSubscriptions(txs, { today: "2026-11-30", homeCurrency: "NGN" });
  const byName = Object.fromEntries(subs.map((s) => [s.displayName, s]));
  assert.equal(byName["Netflix"]?.kind, "subscription");
  assert.equal(byName["Spectranet"]?.kind, "utility");
  assert.equal(byName["Ikeja Electric"]?.billType, "variable");
  assert.equal(byName["Fairmoney Loan Repayment"]?.kind, "obligation");
  assert.ok(!Object.keys(byName).some((n) => /shoprite|salary/i.test(n)), Object.keys(byName).join(", "));
  const inc = income(txs, "NGN", "2026-11-30");
  assert.equal(inc.sources.length, 1);
  assert.equal(inc.monthlyRecurring, 850000);
  assert.equal(inc.nextPayday, "2026-12-25");
});

test("re-importing the same statement adds nothing", async () => {
  const { rows } = parseStatementLines(await pdfLines("tests/fixtures/statement-columns.pdf"), "NGN");
  const first = rowsToTransactions(rows, "pdf", "a");
  const again = markDuplicates(rows, first);
  assert.ok(again.every((r) => r.duplicateOf && !r.include));
  const { added, duplicates } = mergeTransactions(first, rowsToTransactions(rows, "pdf", "b"));
  assert.equal(added, 0);
  assert.equal(duplicates, 54);
});

test("CSV: credits kept, unsigned amounts flagged, mapping requested when unclear", () => {
  const r = extractCsv("Date,Narration,Debit,Credit\n2026-01-05,NETFLIX,5000,\n2026-01-25,SALARY,,850000", "NGN");
  assert.deepEqual(r.rows.map((x) => x.direction), ["debit", "credit"]);
  const unsigned = extractCsv("Date,Description,Amount\n2026-01-05,NETFLIX,5000", "NGN");
  assert.equal(unsigned.rows[0].include, false);
  assert.match(unsigned.rows[0].issues[0], /Money in or out/);
  const odd = extractCsv("When,What,How much\n2026-01-05,NETFLIX,5000", "NGN");
  assert.equal(odd.needsMapping, true);
  const mapped = extractCsv("When,What,How much\n2026-01-05,NETFLIX,-5000", "NGN", { date: "When", description: "What", amount: "How much" });
  assert.equal(mapped.rows[0].direction, "debit");
  assert.equal(mapped.rows[0].include, true);
});
