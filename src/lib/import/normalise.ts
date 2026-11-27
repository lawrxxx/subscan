import { merchantKey } from "../detection/merchants.ts";
import type { Transaction } from "../types.ts";
import type { ExtractedRow } from "./types.ts";

function squash(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Same date, amount, direction and narration ⇒ same transaction. */
export function fingerprint(t: { date: string; amount: number; direction?: string; description: string }) {
  return `${t.date}|${t.amount.toFixed(2)}|${t.direction ?? "debit"}|${squash(t.description).slice(0, 60)}`;
}

/** Mark rows already present in the user's data so they aren't imported twice. */
export function markDuplicates(rows: ExtractedRow[], existing: Transaction[]): ExtractedRow[] {
  const seen = new Set(existing.map((t) => t.fingerprint ?? fingerprint(t)));
  return rows.map((r) => {
    if (!r.date) return r;
    const fp = fingerprint(r);
    return seen.has(fp) ? { ...r, duplicateOf: fp, include: false } : r;
  });
}

/** Flag identical rows inside one file (could be genuine repeats — user decides). */
export function flagInFileRepeats(rows: ExtractedRow[]): ExtractedRow[] {
  const count = new Map<string, number>();
  for (const r of rows) if (r.date) count.set(fingerprint(r), (count.get(fingerprint(r)) ?? 0) + 1);
  return rows.map((r) => (r.date && (count.get(fingerprint(r)) ?? 0) > 1 ? { ...r, issues: [...r.issues, "Appears more than once in this file"] } : r));
}

export function rowsToTransactions(rows: ExtractedRow[], source: Transaction["source"], importId: string): Transaction[] {
  const used = new Map<string, number>();
  return rows
    .filter((r) => r.include && r.date && r.description && r.amount > 0 && !r.duplicateOf)
    .map((r) => {
      const fp = fingerprint(r);
      // Genuine same-day repeats (two identical purchases) keep distinct fingerprints.
      const n = used.get(fp) ?? 0;
      used.set(fp, n + 1);
      return {
        id: `${importId}-${r.id}`,
        date: r.date,
        description: r.description.trim().slice(0, 300),
        merchant: merchantKey(r.description),
        amount: Math.round(r.amount * 100) / 100,
        currency: r.currency,
        direction: r.direction,
        source,
        fingerprint: n ? `${fp}#${n}` : fp,
      };
    });
}

/** Merge new transactions into existing ones, dropping exact fingerprint repeats. */
export function mergeTransactions(existing: Transaction[], incoming: Transaction[]): { merged: Transaction[]; added: number; duplicates: number } {
  const seen = new Set(existing.map((t) => t.fingerprint ?? fingerprint(t)));
  const fresh = incoming.filter((t) => !seen.has(t.fingerprint!));
  const merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
  return { merged, added: fresh.length, duplicates: incoming.length - fresh.length };
}
