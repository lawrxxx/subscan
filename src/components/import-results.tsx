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
      <h1 className="title text-[24px]">organising your transactions</h1>
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
      <h1 className="title text-[24px] sm:text-[26px]">here&rsquo;s what we found</h1>
      <p className="mt-0.5 truncate text-[13px] text-muted">{fileName}{sum.from && sum.to ? ` · ${date(sum.from)} – ${date(sum.to)}` : ""}</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
        <div className="rounded-[14px] bg-sage px-3.5 py-3"><dt className="flex items-center gap-1 text-ink-2"><Icon name="in" size={13} className="text-positive" />money in</dt><dd className="figure mt-1 truncate text-[18px]">{money(sum.moneyIn, home)}</dd></div>
        <div className="rounded-[14px] bg-alert-wash px-3.5 py-3"><dt className="flex items-center gap-1 text-ink-2"><Icon name="out" size={13} className="text-alert" />money out</dt><dd className="figure mt-1 truncate text-[18px]">{money(sum.moneyOut, home)}</dd></div>
        <div className="panel px-3.5 py-3"><dt className="text-muted">transactions</dt><dd className="figure mt-1 text-[18px]">{sum.count}</dd></div>
        <div className="panel px-3.5 py-3"><dt className="text-muted">regular payments</dt><dd className="figure mt-1 text-[18px]">{regular}</dd></div>
      </dl>
      {sum.otherCurrencies.length > 0 && <p className="mt-1.5 text-[12px] text-muted">Totals don&rsquo;t include payments in {sum.otherCurrencies.join(", ")}.</p>}
      {sum.duplicates > 0 && <p className="mt-1.5 text-[12.5px] text-muted">{sum.duplicates} transaction{sum.duplicates === 1 ? " was" : "s were"} already added from an earlier statement and will be skipped.</p>}

      <section className="mt-5" aria-label="Needs your attention">
        {sum.attention.length ? (
          <>
            <h2 className="section-title">{sum.attention.length} need{sum.attention.length === 1 ? "s" : ""} your attention</h2>
            <p className="text-[12.5px] text-muted">Everything else is sorted. Anything you leave here won&rsquo;t be imported.</p>
            {suggestable.length > 1 && (
              <div className="callout callout-sage mt-2.5 flex-wrap py-2.5">
                <span className="text-[12.5px] text-ink-2">{suggestable.length} have a suggested direction based on their wording.</span>
                <button className="btn btn-primary btn-sm" onClick={() => onChange(rows.map((r) => (suggestable.includes(r) ? editRow(r, { direction: r.hint! }) : r)))}>use suggestions for {suggestable.length}</button>
              </div>
            )}
            <div className="panel mt-2.5">
            <ul className="rows">
              {sum.attention.map((r) => {
                const reason = r.issues[0];
                return (
                  <li key={r.id} className="px-4 py-3">
                    <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpenId(r.id)}>
                      <span className="min-w-0">
                        <span className="row-title">{rowLabel(r.description)}</span>
                        <span className="row-sub">{r.date ? date(r.date, "day") : (r.rawDate ?? "No date")}</span>
                      </span>
                      <span className="row-amount">{r.amount ? fmt(r) : "—"}</span>
                    </button>
                    {r.issues.map((i) => <p key={i} className="mt-1 text-[12.5px] text-amber">{REASON_HELP[i] ?? i}</p>)}
                    {reason === ISSUE.direction && r.hint && <p className="text-[12px] text-muted">Suggested from the wording. Please check.</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {reason === ISSUE.direction ? (
                        <>
                          <button className={`btn btn-sm ${r.hint === "credit" ? "btn-ghost !border-accent text-accent" : "btn-ghost"}`} onClick={() => update(r.id, { direction: "credit" })}><Icon name="in" size={14} />money in{r.hint === "credit" && <span className="text-[11px] font-normal text-muted"> · suggested</span>}</button>
                          <button className={`btn btn-sm ${r.hint === "debit" ? "btn-ghost !border-accent text-accent" : "btn-ghost"}`} onClick={() => update(r.id, { direction: "debit" })}><Icon name="out" size={14} />money out{r.hint === "debit" && <span className="text-[11px] font-normal text-muted"> · suggested</span>}</button>
                        </>
                      ) : reason === ISSUE.repeat ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => update(r.id, { include: true })}>keep both</button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(r.id)}>fix it</button>
                      )}
                      <button className="btn btn-quiet btn-sm text-muted" onClick={() => update(r.id, { skipped: true, include: false })}>{reason === ISSUE.repeat ? "skip copy" : "skip"}</button>
                      {r.issues.length > 1 && reason !== ISSUE.repeat && <button className="ml-auto text-[12.5px] text-ink underline underline-offset-2" onClick={() => setOpenId(r.id)}>more to fix</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
            </div>
          </>
        ) : (
          <p className="callout callout-sage justify-start"><Icon name="check" size={16} className="text-positive" />Nothing needs your attention. Everything is sorted.</p>
        )}
      </section>

      <section className="mt-6" aria-label="All transactions">
        <div className="flex items-baseline justify-between">
          <h2 className="section-title">all transactions</h2>
          <span className="text-[12.5px] text-muted">tap one to change it</span>
        </div>
        <div className="panel mt-2">
        <ul className="rows">
          {visible.map((r) => {
            const unsure = r.issues.includes(ISSUE.direction);
            const off = !r.include || r.skipped;
            const credit = !unsure && r.direction === "credit";
            return (
              <li key={r.id}>
                <button className={`row ${off ? "opacity-50" : ""}`} onClick={() => setOpenId(r.id)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`tile h-9 w-9 ${unsure ? "bg-amber-wash text-amber" : credit ? "bg-sage text-positive" : "bg-paper-2 text-ink-2"}`} aria-label={unsure ? "In or out?" : credit ? "Money in" : "Money out"}><Icon name={unsure ? "alert" : credit ? "in" : "out"} size={16} /></span>
                    <span className="min-w-0">
                      <span className="row-title !font-normal">{rowLabel(r.description)}</span>
                      <span className="row-sub">{r.date ? date(r.date, "day") : "No date"}{r.skipped ? " · skipped" : r.issues.length ? " · needs attention" : ""}</span>
                    </span>
                  </span>
                  <span className={`row-amount ${credit ? "text-positive" : ""}`}>{unsure ? "" : credit ? "+" : "−"}{r.amount ? fmt(r) : "—"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        </div>
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
        className="anim-rise max-h-[88dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[10px] bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-[16px]"
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
