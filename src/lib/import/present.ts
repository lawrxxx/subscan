// Presentation helpers for the import results screen: readable names, totals,
// and edits that keep each row's "needs attention" reasons accurate.
import { matchKnown, merchantLabel } from "../detection/merchants.ts";
import { ISSUE, type ExtractedRow } from "./types.ts";

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const looksLikeRef = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, "").length;
  return letters < 3 || s.replace(/\D/g, "").length >= 4 || /[a-z]*\d+[a-z]+\d/i.test(s);
};

/** A readable name taken from the bank's own words. Never invents a merchant, never shows a bare reference. */
export function rowLabel(description: string): string {
  const d = description.replace(/\s+/g, " ").trim();
  const known = matchKnown(d);
  if (known && !known.generic) return known.name;
  const transfer = d.match(/\b(?:nip|trf|tfr|transfer|ussd|mobile|inward|outward|inter-?bank)\b.*?\b(from|to)\b[\s:/-]*([a-z][a-z .'&-]{2,})/i);
  if (transfer) {
    const who = transfer[2].split(/\s+/).filter((w) => /^[a-z.'&-]+$/i.test(w) && !/^(ref|via|for|by|the|acct|account|naration|narration|payment|transfer|trf|nip)$/i.test(w)).slice(0, 3).join(" ");
    if (who.replace(/[^a-z]/gi, "").length >= 3) return `Transfer ${transfer[1].toLowerCase()} ${title(who)}`;
  }
  if (/\b(trf|tfr|transfer)\b/i.test(d)) return "Bank transfer";
  const label = merchantLabel(d).replace(/^(inward|outward|pos|web|purchase|payment)\s+/i, "");
  if (!looksLikeRef(label)) return label;
  if (/\b(nip|trf|tfr|transfer)\b/i.test(d)) return "Bank transfer";
  if (/\b(pos|card|web)\b/i.test(d)) return "Card payment";
  return "Unknown payee";
}

export interface Summary {
  count: number; // rows that will be imported
  moneyIn: number;
  moneyOut: number;
  otherCurrencies: string[];
  from?: string;
  to?: string;
  attention: ExtractedRow[];
  duplicates: number;
  skipped: number;
}

export function summarise(rows: ExtractedRow[], home: string): Summary {
  const kept = rows.filter((r) => r.include && !r.duplicateOf && !r.issues.length);
  const dates = kept.map((r) => r.date).filter(Boolean).sort();
  return {
    count: kept.length,
    moneyIn: kept.filter((r) => r.direction === "credit" && r.currency === home).reduce((x, r) => x + r.amount, 0),
    moneyOut: kept.filter((r) => r.direction === "debit" && r.currency === home).reduce((x, r) => x + r.amount, 0),
    otherCurrencies: [...new Set(kept.filter((r) => r.currency !== home).map((r) => r.currency))],
    from: dates[0],
    to: dates[dates.length - 1],
    attention: rows.filter((r) => r.issues.length && !r.duplicateOf && !r.skipped),
    duplicates: rows.filter((r) => r.duplicateOf).length,
    skipped: rows.filter((r) => r.skipped).length,
  };
}

/** Apply a user edit and re-check which reasons still apply. A row is imported only when nothing is left unclear. */
export function editRow(r: ExtractedRow, patch: Partial<ExtractedRow>): ExtractedRow {
  const next = { ...r, ...patch };
  const issues = next.issues.filter((i) => {
    if (i === ISSUE.date) return !/^\d{4}-\d{2}-\d{2}$/.test(next.date);
    if (i === ISSUE.amount) return !(next.amount > 0);
    if (i === ISSUE.description) return !next.description.trim();
    if (i === ISSUE.direction) return !("direction" in patch);
    if (i === ISSUE.repeat) return !("include" in patch);
    return true;
  });
  if ("direction" in patch) next.directionFrom = "you";
  return { ...next, issues, include: patch.include ?? (issues.length === 0 && !next.skipped) };
}

export const REASON_HELP: Record<string, string> = {
  [ISSUE.direction]: "The statement doesn't say whether this came in or went out.",
  [ISSUE.amount]: "We couldn't read an amount for this one.",
  [ISSUE.date]: "We couldn't read the date.",
  [ISSUE.description]: "There's no description.",
  [ISSUE.repeat]: "The same transaction appears twice. It might be read twice, or it might be two real payments.",
};
