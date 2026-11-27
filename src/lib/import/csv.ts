// CSV statement parser: auto-detects columns (date, narration, amount or
// debit/credit, type, currency) and lets the user override the mapping.
import Papa from "papaparse";
import { ALIASES, detectDateFormat, findColumn, parseAmount, parseDate } from "../detection/csv.ts";
import { directionHint } from "./hints.ts";
import { ISSUE, type ColumnMapping, type ExtractResult, type ExtractedRow, type StatementParser } from "./types.ts";

export function detectMapping(headers: string[]): ColumnMapping {
  return {
    date: findColumn(headers, ALIASES.date),
    description: findColumn(headers, ALIASES.description),
    amount: findColumn(headers, ALIASES.amount),
    debit: findColumn(headers, ALIASES.debit),
    credit: findColumn(headers, ALIASES.credit),
    type: findColumn(headers, ALIASES.type),
    currency: findColumn(headers, ALIASES.currency),
  };
}

export function extractCsv(text: string, homeCurrency: string, override?: ColumnMapping): ExtractResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, "").trim(), { header: true, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const mapping = override ?? detectMapping(headers);
  const warnings: string[] = [];
  if (!mapping.date || !mapping.description || !(mapping.amount || mapping.debit || mapping.credit)) {
    return {
      format: "CSV",
      rows: [],
      headers,
      mapping,
      needsMapping: true,
      warnings: ["We couldn’t tell which columns hold the date, description and amount. Match them below."],
    };
  }
  const data = parsed.data;
  const fmt = detectDateFormat(data.slice(0, 200).map((r) => r[mapping.date!] ?? ""));
  const signed = mapping.amount && !mapping.type ? data.some((r) => (parseAmount(r[mapping.amount!])?.value ?? 0) < 0) : false;
  let assumed = 0;

  const rows: ExtractedRow[] = [];
  data.forEach((r, i) => {
    const issues: string[] = [];
    const rawDate = r[mapping.date!] ?? "";
    const date = parseDate(rawDate, fmt) ?? "";
    if (!date) issues.push(ISSUE.date);
    const description = (r[mapping.description!] ?? "").trim();
    if (!description) issues.push(ISSUE.description);

    let amount = 0;
    let direction: ExtractedRow["direction"] = "debit";
    let from: ExtractedRow["directionFrom"];
    let currency: string | undefined;
    const debit = mapping.debit ? parseAmount(r[mapping.debit]) : null;
    const credit = mapping.credit ? parseAmount(r[mapping.credit]) : null;
    if (debit && Math.abs(debit.value) > 0) {
      amount = Math.abs(debit.value);
      currency = debit.currency;
      from = "columns";
    } else if (credit && Math.abs(credit.value) > 0) {
      amount = Math.abs(credit.value);
      direction = "credit";
      currency = credit.currency;
      from = "columns";
    } else if (mapping.amount) {
      const a = parseAmount(r[mapping.amount]);
      if (a) {
        amount = Math.abs(a.value);
        currency = a.currency;
        const typ = mapping.type ? (r[mapping.type] ?? "").toLowerCase().trim() : "";
        const raw = String(r[mapping.amount] ?? "");
        if (typ && /^(c|cr|credit|deposit|in|d|dr|debit|withdrawal|out)/.test(typ)) [direction, from] = [/^(c|cr|credit|deposit|in)/.test(typ) ? "credit" : "debit", "type column"];
        else if (signed || /^[^\d]*\+/.test(raw.trim())) [direction, from] = [a.value < 0 ? "debit" : "credit", "sign"];
        else {
          // Unsigned amounts with no type column: we can't know the direction.
          issues.push(ISSUE.direction);
          assumed++;
        }
      }
    }
    if (!amount) {
      // Blank lines, opening balances etc. are not transactions — skip quietly.
      if (!date || !description) return;
      issues.push(ISSUE.amount);
    }
    const ccy = (mapping.currency ? r[mapping.currency]?.trim().toUpperCase() : "") || currency || homeCurrency;
    rows.push({ id: `r${i}`, date, description, amount, direction, directionFrom: from, hint: issues.includes(ISSUE.direction) ? directionHint(description) : undefined, rawDate: date ? undefined : rawDate, currency: /^[A-Z]{3}$/.test(ccy) ? ccy : homeCurrency, issues, include: issues.length === 0 });
  });
  if (assumed) warnings.push(`${assumed} transactions don’t say whether money came in or went out.`);
  if (!rows.length) warnings.push("No transactions found in this file.");
  return { format: "CSV", rows, warnings, headers, mapping };
}

export const csvParser: StatementParser = {
  id: "csv",
  label: "CSV export",
  accepts: (f) => /\.(csv|txt)$/i.test(f.name) || f.type === "text/csv",
  async extract(file, opts) {
    return extractCsv(await file.text(), opts.homeCurrency, opts.mapping);
  },
};
