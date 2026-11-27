"use client";
import { useEffect, useMemo, useState } from "react";
import { detectSubscriptions } from "@/lib/detection/engine";
import { date, money } from "@/lib/format";
import { rowsToTransactions } from "@/lib/import/normalise";
import { editRow, REASON_HELP, rowLabel, summarise } from "@/lib/import/present";
import { ISSUE, type ExtractedRow } from "@/lib/import/types";
import type { Transaction } from "@/lib/types";
import { Icon } from "./ui";

/** Stage 2: honest progress through the real processing steps. */
export function Organising({ fileName, phase }: { fileName: string; phase: number }) {
  const steps = ["Reading your statement", "Finding each transaction", "Working out money in and money out", "Spotting regular payments"];
  return (
    <div className="mx-auto max-w-[520px] px-4 py-10 sm:px-6">
      <h1 className="title text-[22px]">Organising your transactions</h1>
      <p className="mt-1 truncate text-[13.5px] text-muted">{fileName}</p>
      <ol className="mt-6 space-y-3" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-[14.5px] ${i > phase ? "text-faint" : ""}`}>
            <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${i < phase ? "bg-accent text-surface" : i === phase ? "border-2 border-accent" : "border border-rule"}`}>
              {i < phase ? <Icon name="check" size={13} /> : i === phase ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : null}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[12.5px] text-muted">This happens on your device. Your statement isn&rsquo;t uploaded anywhere.</p>
    </div>
  );
}

/** Stage 3: what we found, and only the rows that genuinely need a decision. */
export function ImportResults({
  fileName,
  rows,
  home,
  existing,
  onChange,
  onImport,
  onCancel,
}: {
  fileName: string;
  rows: ExtractedRow[];
  home: string;
  existing: Transaction[];
  onChange(rows: ExtractedRow[]): void;
  onImport(): void;
  onCancel(): void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sum = useMemo(() => summarise(rows, home), [rows, home]);
  const regular = useMemo(() => {
    const incoming = rowsToTransactions(rows.filter((r) => !r.issues.length), "pdf", "preview");
    return detectSubscriptions([...existing, ...incoming], { homeCurrency: home }).filter((s) => s.status !== "dismissed").length;
  }, [rows, existing, home]);
  const update = (id: string, patch: Partial<ExtractedRow>) => onChange(rows.map((r) => (r.id === id ? editRow(r, patch) : r)));
  const listed = rows.filter((r) => !r.duplicateOf);
  const suggestable = sum.attention.filter((r) => r.hint && r.issues.length === 1 && r.issues[0] === ISSUE.direction);
  const visible = showAll ? listed : listed.slice(0, 8);
  const open = rows.find((r) => r.id === openId) ?? null;
  const fmt = (r: ExtractedRow) => money(r.amount, r.currency);

  return (
    <div className="mx-auto max-w-[680px] px-4 pt-5 pb-[calc(84px+env(safe-area-inset-bottom))] sm:px-6">
      <h1 className="title text-[22px] sm:text-[24px]">Here&rsquo;s what we found</h1>
      <p className="mt-0.5 truncate text-[13px] text-muted">{fileName}{sum.from && sum.to ? ` · ${date(sum.from)} – ${date(sum.to)}` : ""}</p>

      <dl className="panel mt-4 grid grid-cols-2 text-[13px] [&>div]:px-4 [&>div]:py-3">
        <div className="border-r border-b rule"><dt className="text-muted">Transactions</dt><dd className="figure mt-0.5 text-[20px]">{sum.count}</dd></div>
        <div className="border-b rule"><dt className="text-muted">Regular payments</dt><dd className="figure mt-0.5 text-[20px]">{regular}</dd></div>
        <div className="border-r rule"><dt className="text-muted">Money in</dt><dd className="figure mt-0.5 text-[20px] text-accent">{money(sum.moneyIn, home)}</dd></div>
        <div><dt className="text-muted">Money out</dt><dd className="figure mt-0.5 text-[20px]">{money(sum.moneyOut, home)}</dd></div>
      </dl>
      {sum.otherCurrencies.length > 0 && <p className="mt-1.5 text-[12px] text-muted">Totals don&rsquo;t include payments in {sum.otherCurrencies.join(", ")}.</p>}
      {sum.duplicates > 0 && <p className="mt-1.5 text-[12.5px] text-muted">{sum.duplicates} transaction{sum.duplicates === 1 ? " was" : "s were"} already added from an earlier statement and will be skipped.</p>}

      <section className="mt-5" aria-label="Needs your attention">
        {sum.attention.length ? (
          <>
            <h2 className="text-[15px] font-semibold">{sum.attention.length} need{sum.attention.length === 1 ? "s" : ""} your attention</h2>
            <p className="text-[12.5px] text-muted">Everything else is sorted. Anything you leave here won&rsquo;t be imported.</p>
            {suggestable.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border rule bg-surface px-3 py-2">
                <span className="text-[12.5px] text-ink-2">{suggestable.length} have a suggested direction based on their wording.</span>
                <button className="btn btn-ghost btn-sm" onClick={() => onChange(rows.map((r) => (suggestable.includes(r) ? editRow(r, { direction: r.hint! }) : r)))}>Use the suggestions for {suggestable.length}</button>
              </div>
            )}
            <ul className="mt-2 divide-y divide-[var(--color-rule)] border-y rule">
              {sum.attention.map((r) => {
                const reason = r.issues[0];
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 text-left" onClick={() => setOpenId(r.id)}>
                        <span className="block text-[14.5px] font-medium">{rowLabel(r.description) }</span>
                        <span className="block text-[12.5px] text-muted">{r.date ? date(r.date) : (r.rawDate ?? "No date")}</span>
                      </button>
                      <span className="num shrink-0 text-[14.5px]">{r.amount ? fmt(r) : "—"}</span>
                    </div>
                    {r.issues.map((i) => <p key={i} className="mt-1 text-[12.5px] text-amber">{REASON_HELP[i] ?? i}</p>)}
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-faint">{r.description}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {reason === ISSUE.direction ? (
                        <>
                          <button className={`btn btn-ghost px-2 ${r.hint === "credit" ? "!border-accent text-accent" : ""}`} onClick={() => update(r.id, { direction: "credit" })}>Money in</button>
                          <button className={`btn btn-ghost px-2 ${r.hint === "debit" ? "!border-accent text-accent" : ""}`} onClick={() => update(r.id, { direction: "debit" })}>Money out</button>
                        </>
                      ) : reason === ISSUE.repeat ? (
                        <button className="btn btn-ghost col-span-2 px-2" onClick={() => update(r.id, { include: true })}>Keep both</button>
                      ) : (
                        <button className="btn btn-ghost col-span-2 px-2" onClick={() => setOpenId(r.id)}>Fix it</button>
                      )}
                      <button className="btn btn-quiet px-2" onClick={() => update(r.id, { skipped: true, include: false })}>{reason === ISSUE.repeat ? "Skip copy" : "Skip"}</button>
                    </div>
                    {reason === ISSUE.direction && r.hint && <p className="mt-1 text-[12px] text-muted">Suggested: {r.hint === "credit" ? "money in" : "money out"}, from the wording. Please check.</p>}
                    {r.issues.length > 1 && reason !== ISSUE.repeat && <button className="mt-1 text-[12.5px] text-ink underline" onClick={() => setOpenId(r.id)}>Fix the other details</button>}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="flex items-center gap-2 rounded-[6px] bg-accent-wash px-3 py-2.5 text-[13.5px]"><Icon name="check" size={15} className="text-accent" />Nothing needs your attention.</p>
        )}
      </section>

      <section className="mt-6" aria-label="All transactions">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">All transactions</h2>
          <span className="text-[12.5px] text-muted">Tap one to see or change it</span>
        </div>
        <ul className="mt-2 divide-y divide-[var(--color-rule-soft)] border-y rule">
          {visible.map((r) => {
            const unsure = r.issues.includes(ISSUE.direction);
            const off = !r.include || r.skipped;
            return (
              <li key={r.id}>
                <button className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${off ? "opacity-50" : ""}`} onClick={() => setOpenId(r.id)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">{rowLabel(r.description)}</span>
                    <span className="block text-[12px] text-muted">{r.date ? date(r.date, "day") : "No date"}{r.skipped ? " · skipped" : r.issues.length ? " · needs attention" : ""}</span>
                  </span>
                  <span className={`num shrink-0 text-right text-[14px] ${!unsure && r.direction === "credit" ? "text-accent" : ""}`}>
                    {unsure ? "" : r.direction === "credit" ? "+" : "−"}{r.amount ? fmt(r) : "—"}
                    <span className="block text-[11px] text-muted">{unsure ? "In or out?" : r.direction === "credit" ? "Money in" : "Money out"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {listed.length > 8 && <button className="mt-2 text-[13px] text-muted hover:text-ink" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${listed.length}`}</button>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="min-w-0 text-[12.5px] leading-tight text-muted">
            {sum.attention.length ? <span className="text-amber">{sum.attention.length} unclear won&rsquo;t be imported</span> : "Ready to import"}
            <button className="ml-0 block text-muted underline sm:hidden" onClick={onCancel}>Start again</button>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-ghost hidden sm:inline-flex" onClick={onCancel}>Start again</button>
            <button className="btn btn-primary" disabled={!sum.count} onClick={onImport}>Import {sum.count} transaction{sum.count === 1 ? "" : "s"}</button>
          </div>
        </div>
      </div>

      {open && <RowSheet r={open} onClose={() => setOpenId(null)} onSave={(p) => { update(open.id, p); setOpenId(null); }} />}
    </div>
  );
}

function RowSheet({ r, onClose, onSave }: { r: ExtractedRow; onClose(): void; onSave(p: Partial<ExtractedRow>): void }) {
  const unsure = r.issues.includes(ISSUE.direction);
  const [d, setD] = useState(r.date);
  const [amount, setAmount] = useState(r.amount ? String(r.amount) : "");
  const [dir, setDir] = useState<ExtractedRow["direction"] | null>(unsure ? null : r.direction);
  const [desc, setDesc] = useState(r.description);
  const [keep, setKeep] = useState(!r.skipped);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const how: Record<string, string> = { columns: "the statement's money in / money out columns", balance: "the running balance", sign: "the + or − sign on the amount", marker: "the CR / DR marker", "type column": "the statement's type column", you: "you" };

  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-ink/25 sm:items-center" onClick={onClose} role="dialog" aria-modal aria-label="Transaction details">
      <form
        className="anim-rise max-h-[88dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[10px] bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-[8px]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const amt = Number(amount.replace(/[,\s]/g, ""));
          const patch: Partial<ExtractedRow> = { date: d, description: desc.trim(), amount: Number.isFinite(amt) ? amt : 0 };
          if (dir && (unsure || dir !== r.direction)) patch.direction = dir;
          if (!keep) Object.assign(patch, { skipped: true, include: false });
          else if (r.skipped) patch.skipped = false;
          if (keep && r.issues.includes(ISSUE.repeat)) patch.include = true;
          onSave(patch);
        }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-rule sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold">{rowLabel(r.description)}</div>
            <div className="text-[12.5px] text-muted">{r.directionFrom ? `Money ${r.direction === "credit" ? "in" : "out"}, from ${how[r.directionFrom]}` : "We couldn't tell if this was money in or out"}</div>
          </div>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="mt-3 grid gap-3">
          <fieldset>
            <legend className="text-[12.5px] text-muted">Money in or out</legend>
            <div className="seg mt-1 flex">
              <button type="button" className="flex-1" aria-pressed={dir === "credit"} onClick={() => setDir("credit")}>Money in</button>
              <button type="button" className="flex-1" aria-pressed={dir === "debit"} onClick={() => setDir("debit")}>Money out</button>
            </div>
          </fieldset>
          <label className="text-[12.5px] text-muted">Amount ({r.currency})<input className="input num mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="text-[12.5px] text-muted">Date<input type="date" className="input mt-1" value={d} onChange={(e) => setD(e.target.value)} />{r.rawDate && <span className="mt-0.5 block text-[11.5px]">Statement shows “{r.rawDate}”</span>}</label>
          <label className="text-[12.5px] text-muted">What your bank wrote<textarea className="input mt-1 h-auto min-h-[64px] py-2 leading-snug" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></label>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" className="accent-[var(--color-accent)]" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Import this transaction</label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}
