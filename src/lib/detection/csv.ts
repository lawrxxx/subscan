import Papa from "papaparse";
import type { Transaction } from "../types.ts";
import { merchantKey } from "./merchants.ts";

export interface ParseResult {
  transactions: Transaction[];
  skipped: number;
  columns: { date?: string; description?: string; amount?: string; debit?: string; credit?: string; currency?: string; type?: string };
  dateFormat: "iso" | "dmy" | "mdy" | "text";
  warnings: string[];
}

export const ALIASES = {
  date: ["date", "transaction date", "trans date", "posted date", "value date", "booking date", "txn date", "posting date"],
  description: ["description", "narration", "details", "memo", "merchant", "payee", "name", "transaction details", "remarks", "reference"],
  amount: ["amount", "transaction amount", "value", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "paid out", "dr", "debit amount"],
  credit: ["credit", "deposit", "deposits", "money in", "paid in", "cr", "credit amount"],
  currency: ["currency", "ccy", "curr"],
  type: ["type", "dr/cr", "transaction type", "debit/credit"],
};

export function findColumn(headers: string[], names: string[]): string | undefined {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return headers[i];
  }
  for (const n of names) {
    const i = norm.findIndex((h) => h.includes(n));
    if (i >= 0) return headers[i];
  }
  return undefined;
}

const SYMBOLS: Record<string, string> = { "₦": "NGN", "$": "USD", "£": "GBP", "€": "EUR", "R": "ZAR", "KSh": "KES" };

export function parseAmount(raw: unknown): { value: number; currency?: string } | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let currency: string | undefined;
  const code = s.match(/\b(NGN|USD|GBP|EUR|KES|ZAR|GHS|CAD)\b/i);
  if (code) currency = code[1].toUpperCase();
  for (const [sym, c] of Object.entries(SYMBOLS)) {
    if (sym.length === 1 && sym !== "R" && s.includes(sym)) currency = currency ?? c;
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) negative = true;
  if (/^[^\d]*-/.test(s)) negative = true; // "-1200", "₦-1200", "NGN -1200"
  if (/\bDR\b/i.test(s)) negative = true;
  if (/^[\d.,\s]+-$/.test(s.replace(/[^\d.,\s-]/g, "").trim())) negative = true; // "1,200.00-"
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  // "1.234,56" (EU) vs "1,234.56"
  if (/\d+\.\d{3},\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return { value: negative ? -v : v, currency };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function detectDateFormat(samples: string[]): ParseResult["dateFormat"] {
  let dmy = false;
  let mdy = false;
  for (const s of samples) {
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return "iso";
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      if (Number(m[1]) > 12) dmy = true;
      if (Number(m[2]) > 12) mdy = true;
    } else if (/[a-z]{3}/i.test(t)) return "text";
  }
  if (mdy && !dmy) return "mdy";
  return "dmy"; // default for NG/UK-style bank exports
}

export function parseDate(raw: string, fmt: ParseResult["dateFormat"]): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = fmt === "mdy" ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  // 12-Jan-2025, 12 Jan 2025, Jan 12, 2025
  m = t.match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{2,4})/i);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo > 0) return `${y}-${pad(mo)}-${pad(Number(m[1]))}`;
  }
  m = t.match(/^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (mo > 0) return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`;
  }
  return null;
}

export function parseTransactionsCsv(text: string, homeCurrency = "NGN", source: Transaction["source"] = "csv"): ParseResult {
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const columns = {
    date: findColumn(headers, ALIASES.date),
    description: findColumn(headers, ALIASES.description),
    amount: findColumn(headers, ALIASES.amount),
    debit: findColumn(headers, ALIASES.debit),
    credit: findColumn(headers, ALIASES.credit),
    currency: findColumn(headers, ALIASES.currency),
    type: findColumn(headers, ALIASES.type),
  };
  if (!columns.date || !columns.description || !(columns.amount || columns.debit)) {
    return {
      transactions: [],
      skipped: parsed.data.length,
      columns,
      dateFormat: "dmy",
      warnings: [
        `Could not find required columns. Found: ${headers.join(", ") || "none"}. Need a date, a description/narration and an amount (or debit) column.`,
      ],
    };
  }
  const rows = parsed.data;
  const dateFormat = detectDateFormat(rows.slice(0, 200).map((r) => r[columns.date!] ?? ""));
  const anyNegative = columns.amount ? rows.some((r) => (parseAmount(r[columns.amount!])?.value ?? 0) < 0) : false;

  const transactions: Transaction[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const date = parseDate(r[columns.date!] ?? "", dateFormat);
    const description = (r[columns.description!] ?? "").trim();
    if (!date || !description) {
      skipped++;
      return;
    }
    let out: number | null = null;
    let currency: string | undefined;
    if (columns.debit && r[columns.debit]) {
      const p = parseAmount(r[columns.debit]);
      if (p && Math.abs(p.value) > 0) {
        out = Math.abs(p.value);
        currency = p.currency;
      }
    }
    if (out === null && columns.amount) {
      const p = parseAmount(r[columns.amount]);
      if (p) {
        currency = p.currency;
        const typ = columns.type ? (r[columns.type] ?? "").toLowerCase() : "";
        if (typ) out = /^(d|dr|debit|withdraw)/.test(typ) ? Math.abs(p.value) : null;
        else if (anyNegative) out = p.value < 0 ? Math.abs(p.value) : null;
        else out = Math.abs(p.value);
      }
    }
    if (out === null || out === 0) {
      skipped++; // credits / zero rows are not spending
      return;
    }
    const ccy = (columns.currency ? r[columns.currency]?.trim().toUpperCase() : undefined) || currency || homeCurrency;
    transactions.push({
      id: `${source}-${i}-${date}`,
      date,
      description,
      merchant: merchantKey(description),
      amount: Math.round(out * 100) / 100,
      currency: ccy,
      source,
    });
  });
  if (!transactions.length) warnings.push("No outgoing transactions found in this file.");
  return { transactions, skipped, columns, dateFormat, warnings };
}
