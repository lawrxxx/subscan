"use client";
import { useMemo, useState } from "react";
import type { ExtractedRow } from "@/lib/import/types";
import { money } from "@/lib/format";

type Filter = "all" | "review" | "out" | "in" | "dupes";
const PAGE = 60;

const DIRECTION_ISSUE = "Money in or out? Assumed money out";

/** Re-derive a row's issues after the user edits it. */
function revalidate(r: ExtractedRow, touchedDirection = false): ExtractedRow {
  const issues = r.issues.filter((i) => {
    if (i.startsWith("Unreadable date")) return !/^\d{4}-\d{2}-\d{2}$/.test(r.date);
    if (i === "No description") return !r.description.trim();
    if (i === "No amount") return !(r.amount > 0);
    if (i === DIRECTION_ISSUE) return !touchedDirection;
    return true;
  });
  return { ...r, issues };
}

export function ReviewTable({ rows, onChange }: { rows: ExtractedRow[]; onChange(rows: ExtractedRow[]): void }) {
  const [filter, setFilter] = useState<Filter>(rows.some((r) => r.issues.length) ? "review" : "all");
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(
    () => ({
      all: rows.length,
      review: rows.filter((r) => r.issues.length && !r.duplicateOf).length,
      out: rows.filter((r) => r.direction === "debit").length,
      in: rows.filter((r) => r.direction === "credit").length,
      dupes: rows.filter((r) => r.duplicateOf).length,
    }),
    [rows],
  );
  const visible = rows.filter((r) =>
    filter === "review" ? r.issues.length && !r.duplicateOf : filter === "out" ? r.direction === "debit" : filter === "in" ? r.direction === "credit" : filter === "dupes" ? !!r.duplicateOf : true,
  );

  const update = (id: string, patch: Partial<ExtractedRow>, touchedDirection = false) =>
    onChange(rows.map((r) => (r.id === id ? revalidate({ ...r, ...patch }, touchedDirection) : r)));
  const setAll = (pred: (r: ExtractedRow) => boolean, include: boolean) => onChange(rows.map((r) => (pred(r) && !r.duplicateOf ? { ...r, include } : r)));

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="tabs" role="tablist">
          {(
            [
              ["all", "All"],
              ["review", "Needs review"],
              ["out", "Money out"],
              ["in", "Money in"],
              ["dupes", "Already imported"],
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setLimit(PAGE); }} className={k === "review" && counts.review ? "text-amber" : ""}>
              {l} <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-[12px]">
          <button className="btn btn-quiet btn-sm" onClick={() => setAll((r) => visible.includes(r), true)}>Include shown</button>
          <button className="btn btn-quiet btn-sm" onClick={() => setAll((r) => visible.includes(r), false)}>Exclude shown</button>
        </div>
      </div>

      {filter === "review" && counts.review > 0 && (
        <p className="mt-3 rounded-[6px] bg-amber-wash px-3 py-2 text-[13px] text-ink-2">
          These rows have something we couldn&rsquo;t read with confidence. Fix them, or tick them to include as shown. Unticked rows are not saved.
        </p>
      )}

      <ul className="panel mt-3 divide-y divide-[var(--color-rule)] px-3">
        {visible.slice(0, limit).map((r) => (
          <li key={r.id} className={`grid grid-cols-[24px_1fr] gap-x-3 gap-y-2 py-3 md:grid-cols-[24px_132px_1fr_130px_120px] md:items-center ${r.include ? "" : "opacity-60"}`}>
            <input type="checkbox" aria-label="Include this transaction" className="mt-1 accent-[var(--color-accent)] md:mt-0" checked={r.include} disabled={!!r.duplicateOf} onChange={(e) => update(r.id, { include: e.target.checked })} />
            <input type="date" aria-label="Date" className={`input h-8 px-2 text-[13px] ${r.date ? "" : "border-alert"}`} value={r.date} onChange={(e) => update(r.id, { date: e.target.value })} />
            <div className="col-start-2 min-w-0 md:col-start-auto">
              <input aria-label="Description" className="input h-8 px-2 text-[13px]" value={r.description} onChange={(e) => update(r.id, { description: e.target.value })} />
              {(r.issues.length > 0 || r.duplicateOf) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.duplicateOf && <span className="tag text-muted">Already imported — skipped</span>}
                  {r.issues.map((i) => <span key={i} className="tag border-amber/40 bg-amber-wash text-amber">{i}</span>)}
                </div>
              )}
            </div>
            <input aria-label="Amount" inputMode="decimal" className="input col-start-2 h-8 px-2 text-right text-[13px] num md:col-start-auto" value={r.amount || ""} onChange={(e) => update(r.id, { amount: Math.abs(Number(e.target.value.replace(/,/g, ""))) || 0 })} />
            <div className="seg col-start-2 md:col-start-auto" role="group" aria-label="Money in or out">
              {(["debit", "credit"] as const).map((d) => (
                <button key={d} aria-pressed={r.direction === d} onClick={() => update(r.id, { direction: d }, true)} className="flex-1">
                  {d === "debit" ? "Out" : "In"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && <p className="py-8 text-[14px] text-muted">Nothing in this view.</p>}
      {visible.length > limit && (
        <button className="btn btn-ghost mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>Show {Math.min(PAGE * 2, visible.length - limit)} more of {visible.length - limit}</button>
      )}
    </div>
  );
}

export function reviewTotals(rows: ExtractedRow[], currency: string) {
  const inc = rows.filter((r) => r.include && !r.duplicateOf);
  const out = inc.filter((r) => r.direction === "debit" && r.currency === currency).reduce((s, r) => s + r.amount, 0);
  const inn = inc.filter((r) => r.direction === "credit" && r.currency === currency).reduce((s, r) => s + r.amount, 0);
  const dates = inc.map((r) => r.date).filter(Boolean).sort();
  return { count: inc.length, out: money(out, currency), in: money(inn, currency), from: dates[0], to: dates[dates.length - 1] };
}
