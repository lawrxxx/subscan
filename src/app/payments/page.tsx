"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddBill } from "@/components/add-bill";
import { EmptyPanel, PageBar, UploadButton } from "@/components/ui";
import { commitments } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { date, money } from "@/lib/format";
import { displayLabel, frequencyText, GROUP_LABEL, groupOf, predictedNext, rawDescription, type Group } from "@/lib/review";
import type { Subscription } from "@/lib/types";

export default function Payments() {
  const { state, ready, updateSubscription, addManual, logAction } = useStore();
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const [group, setGroup] = useState<"all" | Group>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("add")) setAdding(true);
  }, []);

  const subs = state.subscriptions;
  const confirmed = useMemo(() => subs.filter((s) => s.status === "confirmed" || (s.manual && s.status !== "dismissed")), [subs]);
  const toCheck = subs.filter((s) => s.status === "detected" && !s.manual);
  const dismissed = subs.filter((s) => s.status === "dismissed");
  const total = useMemo(() => commitments(confirmed, home, rates), [confirmed, home, rates]);
  const groups = useMemo(() => (Object.keys(GROUP_LABEL) as Group[]).filter((g) => confirmed.some((s) => groupOf(s) === g)), [confirmed]);
  const name = (s: Subscription) => displayLabel(s, rawDescription(s, state.transactions)).name;

  const list = confirmed
    .filter((s) => group === "all" || groupOf(s) === group)
    .filter((s) => !q || `${name(s)} ${s.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (predictedNext(a) ?? "9999").localeCompare(predictedNext(b) ?? "9999"));

  if (!ready) return null;

  return (
    <div>
      <PageBar
        title="Payments"
        sub={confirmed.length ? <>{confirmed.length} regular payment{confirmed.length === 1 ? "" : "s"} · <span className="num text-ink">{money(total.monthlyHome ?? 0, home)}</span> a month</> : "Subscriptions, bills and other money that goes out regularly"}
        actions={confirmed.length > 0 && !adding ? <button className="btn btn-ghost" onClick={() => setAdding(true)}>Add a payment</button> : undefined}
      />

      <div className="space-y-4 px-4 sm:px-6 lg:px-8">
        {toCheck.length > 0 && (
          <Link href="/review" className="flex items-center justify-between gap-3 rounded-[6px] border border-amber/30 bg-amber-wash px-4 py-3 text-[14px] hover:border-amber/60">
            <span><span className="font-semibold">{toCheck.length} payment{toCheck.length === 1 ? "" : "s"} to check.</span> <span className="text-ink-2">They&rsquo;ll appear here once you confirm them.</span></span>
            <span className="shrink-0 font-medium text-amber">Check <span aria-hidden>→</span></span>
          </Link>
        )}

        {adding && <AddBill home={home} onCancel={() => setAdding(false)} onAdd={(s) => { addManual(s); logAction({ kind: "confirmed", title: `Added ${s.displayName}` }); setAdding(false); }} />}

        {!confirmed.length ? (
          !adding && (
            <section className="panel">
              {state.transactions.length ? (
                <EmptyPanel icon="bills" title={toCheck.length ? "Nothing confirmed yet" : "No regular payments yet"} action={<div className="flex flex-wrap justify-center gap-2">{toCheck.length ? <Link href="/review" className="btn btn-primary">Check your payments</Link> : <UploadButton label="Add more months" />}<button className="btn btn-ghost" onClick={() => setAdding(true)}>Add one yourself</button></div>}>
                  {toCheck.length ? "Check the payments we found and confirm the ones you really pay." : "We didn't find anything that repeats yet. A payment needs to show up at least twice."}
                </EmptyPanel>
              ) : (
                <EmptyPanel icon="upload" title="No payments yet" action={<div className="flex flex-wrap justify-center gap-2"><UploadButton label="Add a statement" /><button className="btn btn-ghost" onClick={() => setAdding(true)}>Add one yourself</button></div>}>
                  Add a bank statement and we&rsquo;ll find your subscriptions, bills and other regular payments.
                </EmptyPanel>
              )}
            </section>
          )
        ) : (
          <section className="panel">
            {(groups.length > 1 || confirmed.length > 8) && (
              <div className="border-b rule px-3">
                {groups.length > 1 && (
                  <div className="tabs border-b-0" role="tablist">
                    <button role="tab" aria-selected={group === "all"} onClick={() => setGroup("all")}>All</button>
                    {groups.map((g) => <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g]}</button>)}
                  </div>
                )}
                {confirmed.length > 8 && <input className="input my-2.5" placeholder="Search payments" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />}
              </div>
            )}
            {!list.length ? (
              <p className="px-4 py-6 text-center text-[13.5px] text-muted">No payments match.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-rule-soft)]">
                {list.map((s) => {
                  const next = predictedNext(s);
                  return (
                    <li key={s.id}>
                      <Link href={`/payments/${encodeURIComponent(s.id)}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper-2/50">
                        <span className="min-w-0">
                          <span className="block truncate text-[14.5px] font-medium">{name(s)}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {GROUP_LABEL[groupOf(s)]}
                            {frequencyText(s) ? ` · ${frequencyText(s)!.toLowerCase()}` : ""}
                            {s.priceChange && s.priceChange.pct > 0 && <span className="text-alert"> · up {Math.round(s.priceChange.pct * 100)}%</span>}
                            {s.missed && !s.lapsed && <span className="text-alert"> · missed?</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="num block text-[14.5px]">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                          <span className="block text-[12px] text-muted">{s.lapsed ? "Stopped?" : next ? `Next ${date(next, "day")}` : ""}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {dismissed.length > 0 && (
          <section>
            <button className="text-[13px] text-muted hover:text-ink" onClick={() => setShowDismissed((v) => !v)} aria-expanded={showDismissed}>
              {showDismissed ? "Hide" : "Show"} {dismissed.length} you said aren&rsquo;t regular
            </button>
            {showDismissed && (
              <ul className="mt-2 divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
                {dismissed.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                    <span className="min-w-0 truncate">{name(s)} <span className="num text-muted">· {money(s.amount, s.currency)}</span></span>
                    <button className="btn btn-quiet btn-sm" onClick={() => { updateSubscription(s.id, { status: "detected" }); logAction({ kind: "restored", title: `Moved back to check: ${name(s)}`, href: "/review" }); }}>Check again</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
