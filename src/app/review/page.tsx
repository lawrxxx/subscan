"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EditPayment } from "@/components/edit-payment";
import { Wordmark } from "@/components/shell";
import { Avatar, Icon } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { date, money, shortCadence } from "@/lib/format";
import {
  amountsVary,
  bulkEligible,
  displayLabel,
  explain,
  frequencyText,
  level,
  LEVEL_LABEL,
  predictedNext,
  rawDescription,
  type Level,
} from "@/lib/review";
import type { Subscription } from "@/lib/types";

const RANK: Record<Level, number> = { likely: 0, possible: 1, review: 2 };
const LEVEL_TONE: Record<Level, string> = { likely: "text-accent", possible: "text-ink-2", review: "text-amber" };

export default function Review() {
  const { state, ready, updateSubscription, logAction } = useStore();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showDone, setShowDone] = useState<"confirmed" | "dismissed" | null>(null);
  const [mode, setMode] = useState<"one" | "all">("one");
  const [skipped, setSkipped] = useState<string[]>([]);

  const all = useMemo(() => state.subscriptions.filter((s) => !s.manual), [state.subscriptions]);
  const pending = useMemo(() => all.filter((s) => s.status === "detected").sort((a, b) => skipped.indexOf(a.id) - skipped.indexOf(b.id) || RANK[level(a)] - RANK[level(b)] || b.amount - a.amount), [all, skipped]);
  const confirmed = all.filter((s) => s.status === "confirmed");
  const dismissed = all.filter((s) => s.status === "dismissed");
  const eligible = pending.filter(bulkEligible);
  const done = all.length - pending.length;

  if (!ready) return null;

  const set = (s: Subscription, status: Subscription["status"], name: string) => {
    updateSubscription(s.id, { status });
    logAction({ kind: status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "restored", title: `${status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Marked not regular:" : "Moved back to review:"} ${name}`, href: `/payments/${encodeURIComponent(s.id)}` });
  };
  const confirmEligible = () => {
    eligible.forEach((s) => updateSubscription(s.id, { status: "confirmed" }));
    logAction({ kind: "confirmed", title: `Confirmed ${eligible.length} regular payment${eligible.length === 1 ? "" : "s"}`, detail: eligible.map((s) => s.displayName).join(", "), href: "/payments" });
    setBulkOpen(false);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Wordmark className="text-[19px]" />
          <Link href="/" className="btn btn-quiet btn-sm" aria-label="Close">Close</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-5 pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-6">
        <h1 className="title text-[24px] sm:text-[26px]">check your payments</h1>
        <p className="mt-1 text-[13.5px] text-muted">These came up more than once. Tell us which ones you pay regularly.</p>

        {all.length > 0 && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-medium"><span className="num">{done}</span> of <span className="num">{all.length}</span> reviewed</span>
              <span className="text-muted">{confirmed.length} regular · {dismissed.length} not regular</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={done} aria-label="Review progress">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {!all.length ? (
          <div className="mt-6 border-y rule py-5 text-[14px]">
            <p className="font-medium">No repeating payments found.</p>
            <p className="mt-1 text-muted">A payment needs to appear at least twice before we suggest it. Adding three or more months usually helps.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/onboarding" className="btn btn-ghost">Add another statement</Link>
              <Link href="/payments?add=1" className="btn btn-ghost">Add a payment yourself</Link>
            </div>
          </div>
        ) : (
          <>
            {eligible.length > 1 && (
              <div className="mt-4 rounded-[14px] bg-sage">
                {!bulkOpen ? (
                  <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-ink-2"><span className="font-medium text-ink">{eligible.length} are very likely regular</span>: they came in three or more times, evenly spaced.</p>
                    <button className="btn btn-ghost btn-sm shrink-0" onClick={() => setBulkOpen(true)}>Review and confirm {eligible.length}</button>
                  </div>
                ) : (
                  <div className="px-3 py-3">
                    <p className="text-[13.5px] font-medium">Confirm these {eligible.length} payments?</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">They&rsquo;ll count towards your monthly total. Anything less certain stays for you to check. You can undo each one below.</p>
                    <ul className="mt-2 divide-y divide-[var(--color-rule-soft)] text-[13px]">
                      {eligible.map((s) => (
                        <li key={s.id} className="flex justify-between gap-3 py-1.5">
                          <span className="truncate">{displayLabel(s, rawDescription(s, state.transactions)).name}</span>
                          <span className="num shrink-0">{amountsVary(s) ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                      <button className="btn btn-ghost" onClick={() => setBulkOpen(false)}>Cancel</button>
                      <button className="btn btn-primary" onClick={confirmEligible}>Confirm {eligible.length} payments</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {pending.length > 0 ? (
              <>
              {pending.length > 1 && (
                <div className="mt-4 flex justify-end text-[12.5px] text-muted">
                  <button className="hover:text-ink" onClick={() => setMode(mode === "one" ? "all" : "one")}>{mode === "one" ? `See all ${pending.length} at once` : "One at a time"}</button>
                </div>
              )}
              <ul className="panel rows mt-1.5" aria-label="Suggestions awaiting review">
                {(mode === "one" ? pending.slice(0, 1) : pending).map((s) => <Suggestion key={s.id} s={s} raw={rawDescription(s, state.transactions)} onStatus={set} onSave={(p, name) => { updateSubscription(s.id, { ...p, status: "confirmed" }); logAction({ kind: "confirmed", title: `Edited and confirmed ${name}`, href: `/payments/${encodeURIComponent(s.id)}` }); }} />)}
              </ul>
              {mode === "one" && pending.length > 1 && (
                <button className="mt-2 text-[13px] text-muted hover:text-ink" onClick={() => setSkipped((k) => [...k.filter((x) => x !== pending[0].id), pending[0].id])}>Not sure, skip for now</button>
              )}
              </>
            ) : (
              <div className="callout callout-sage mt-5 block text-[14px]">
                <span className="font-medium">All done.</span> You&rsquo;ve reviewed every suggestion.
              </div>
            )}

            {(confirmed.length > 0 || dismissed.length > 0) && (
              <div className="mt-6 space-y-2">
                {([["confirmed", "Confirmed", confirmed], ["dismissed", "Not regular", dismissed]] as const).map(([k, label, list]) =>
                  list.length ? (
                    <section key={k}>
                      <button className="flex w-full items-center justify-between py-2 text-left text-[13.5px] font-medium" onClick={() => setShowDone((v) => (v === k ? null : k))} aria-expanded={showDone === k}>
                        <span>{label} <span className="num text-muted">({list.length})</span></span>
                        <span className="text-[12.5px] font-normal text-muted">{showDone === k ? "Hide" : "Show"}</span>
                      </button>
                      {showDone === k && (
                        <ul className="divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
                          {list.map((s) => {
                            const n = displayLabel(s, rawDescription(s, state.transactions)).name;
                            return (
                              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                                <span className="min-w-0 truncate">{n}</span>
                                <span className="flex shrink-0 items-center gap-3">
                                  <span className="num text-muted">{money(s.amount, s.currency)}</span>
                                  <button className="btn btn-quiet btn-sm" onClick={() => set(s, "detected", n)}>Undo</button>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  ) : null,
                )}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <span className="text-[13px] text-muted">{pending.length ? `${pending.length} left to review` : "Everything reviewed"}</span>
          <Link href="/" className={pending.length ? "btn btn-ghost" : "btn btn-primary"}>{pending.length ? "Finish later" : "See my overview"}</Link>
        </div>
      </footer>
    </div>
  );
}

function Suggestion({ s, raw, onStatus, onSave }: { s: Subscription; raw?: string; onStatus(s: Subscription, st: Subscription["status"], name: string): void; onSave(p: Partial<Subscription>, name: string): void }) {
  const [editing, setEditing] = useState(false);
  const label = displayLabel(s, raw);
  const lv = level(s);
  const fmt = (n: number) => money(n, s.currency);
  const freq = shortCadence(frequencyText(s));
  const next = predictedNext(s);
  const dates = s.history.map((h) => h.date).sort();
  const shown = dates.slice(-4);
  const varies = amountsVary(s);

  const [details, setDetails] = useState(false);
  return (
    <li className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={label.name} size={40} />
          <div className="min-w-0">
            <div className={`truncate text-[15.5px] font-semibold ${label.unknown ? "text-ink-2" : ""}`}>{label.name}</div>
            <div className="truncate text-[12.5px] text-muted">{freq ?? "Frequency unclear"}{next ? ` · next ${date(next, "day")}` : ""}</div>
          </div>
        </div>
        <div className="num shrink-0 text-[16px] font-semibold">{varies ? "≈ " : ""}{fmt(s.amount)}</div>
      </div>

      <div className="mt-2.5 text-[13px] leading-snug">
        <span className={`font-medium ${LEVEL_TONE[lv]}`}>{LEVEL_LABEL[lv]}.</span> <span className="text-ink-2">{explain(s, fmt)}</span>
      </div>
      <button className="mt-1 text-[12.5px] text-muted underline underline-offset-2 hover:text-ink" onClick={() => setDetails((v) => !v)} aria-expanded={details}>{details ? "hide details" : `see ${s.history.length} payments`}</button>
      {details && (
        <div className="mt-1.5 rounded-[10px] bg-paper-2 px-3 py-2 text-[12px] text-ink-2">
          {label.detail && <div className="truncate" title={label.detail}>{label.unknown ? "Statement shows: " : ""}{label.detail}</div>}
          <div><span className="num">{s.history.length} payments</span>: {dates.length > shown.length && "… "}
          <span className="num">{shown.map((d) => date(d, "day")).join(", ")}{dates[dates.length - 1].slice(0, 4) !== new Date().toISOString().slice(0, 4) ? ` ${dates[dates.length - 1].slice(0, 4)}` : ""}</span>
          {" · "}
          {next ? <>next expected around <span className="num">{date(next)}</span></> : "not enough history to predict the next one"}</div>
        </div>
      )}

      {editing ? (
        <EditPayment s={s} initialName={label.unknown ? "" : label.name} submitLabel="Save and confirm" onCancel={() => setEditing(false)} onSave={(p, name) => { onSave(p, name); setEditing(false); }} />
      ) : (
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button className="btn btn-primary col-span-2 sm:order-3" onClick={() => onStatus(s, "confirmed", label.name)} aria-label={`Confirm ${label.name} as a regular payment`}><Icon name="check" size={16} />Yes, regular</button>
          <button className="btn btn-ghost" onClick={() => onStatus(s, "dismissed", label.name)} aria-label={`${label.name} is not a regular payment`}>Not regular</button>
          <button className="btn btn-quiet" onClick={() => setEditing(true)} aria-label={`Edit details for ${label.name}`}>Edit details</button>
        </div>
      )}
    </li>
  );
}
