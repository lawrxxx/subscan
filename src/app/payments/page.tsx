"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddBill } from "@/components/add-bill";
import { Avatar, EmptyPanel, Icon, PageBar, UploadButton } from "@/components/ui";
import { commitments } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { date, money, shortCadence } from "@/lib/format";
import { displayLabel, frequencyText, GROUP_LABEL, groupOf, LEVEL_LABEL, level, predictedNext, rawDescription, type Group } from "@/lib/review";
import type { Subscription } from "@/lib/types";

export default function Payments() {
  const { state, ready, updateSubscription, addManual, logAction } = useStore();
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const [group, setGroup] = useState<"all" | Group>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [tab, setTab] = useState<"regular" | "suggestions">("regular");

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

  const suggestionsTab = tab === "suggestions" && toCheck.length > 0;

  return (
    <div>
      <PageBar
        title="payments"
        sub={confirmed.length ? <>your regular and upcoming payments · <span className="num text-ink">{money(total.monthlyHome ?? 0, home)}</span> a month</> : "subscriptions, bills and other money that goes out regularly"}
      />

      <div className="mx-auto max-w-[760px] space-y-4 px-4 sm:px-6 lg:mx-0 lg:px-8">
        {(confirmed.length > 0 || toCheck.length > 0) && (
          <div className="seg flex w-full sm:w-auto sm:inline-flex" role="tablist" aria-label="Payments">
            <button role="tab" className="flex-1 sm:flex-none" aria-selected={!suggestionsTab} aria-pressed={!suggestionsTab} onClick={() => setTab("regular")}>regular<span className="count">{confirmed.length}</span></button>
            <button role="tab" className="flex-1 sm:flex-none" aria-selected={suggestionsTab} aria-pressed={suggestionsTab} disabled={!toCheck.length} onClick={() => setTab("suggestions")}>suggestions<span className="count">{toCheck.length}</span></button>
          </div>
        )}

        {adding && <AddBill home={home} onCancel={() => setAdding(false)} onAdd={(s) => { addManual(s); logAction({ kind: "confirmed", title: `Added ${s.displayName}` }); setAdding(false); }} />}

        {suggestionsTab ? (
          <section className="space-y-3">
            <div className="callout callout-amber">
              <span className="min-w-0"><span className="block font-semibold">These came up more than once</span><span className="block text-[12.5px] text-ink-2">Confirm the ones you really pay. They&rsquo;ll move to regular.</span></span>
              <Link href="/review" className="btn btn-primary btn-sm shrink-0">check now</Link>
            </div>
            <div className="panel">
              <ul className="rows">
                {toCheck.map((s) => (
                  <li key={s.id}>
                    <Link href="/review" className="row">
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={name(s)} size={36} />
                        <span className="min-w-0">
                          <span className="row-title">{name(s)}</span>
                          <span className="row-sub">{shortCadence(frequencyText(s)) ?? "Frequency unclear"} · {LEVEL_LABEL[level(s)].toLowerCase()}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="row-amount">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                        <Icon name="chev" size={16} className="chev" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : !confirmed.length ? (
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
          <>
            {(groups.length > 1 && confirmed.length > 6 || confirmed.length > 8) && (
              <div className="space-y-2.5">
                {groups.length > 1 && confirmed.length > 6 && (
                  <div className="tabs" role="tablist" aria-label="Type of payment">
                    <button role="tab" aria-selected={group === "all"} onClick={() => setGroup("all")}>All</button>
                    {groups.map((g) => <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)}>{GROUP_LABEL[g]}</button>)}
                  </div>
                )}
                {confirmed.length > 8 && <input className="input" placeholder="Search payments" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />}
              </div>
            )}
            <section className="panel">
              {!list.length ? (
                <p className="px-4 py-6 text-center text-[13.5px] text-muted">No payments match.</p>
              ) : (
                <ul className="rows">
                  {list.map((s) => {
                    const next = predictedNext(s);
                    const freq = shortCadence(frequencyText(s));
                    const flag = s.missed && !s.lapsed ? ["missed?", "pill-red"] : s.lapsed ? ["stopped?", ""] : s.priceChange && s.priceChange.pct > 0 ? [`up ${Math.round(s.priceChange.pct * 100)}%`, "pill-amber"] : s.autopay ? ["auto", "pill-green"] : null;
                    return (
                      <li key={s.id}>
                        <Link href={`/payments/${encodeURIComponent(s.id)}`} className="row">
                          <span className="flex min-w-0 items-center gap-3">
                            <Avatar name={name(s)} size={36} />
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-center gap-2"><span className="row-title">{name(s)}</span>{flag && <span className={`pill pill-plain shrink-0 ${flag[1]}`}>{flag[0]}</span>}</span>
                              <span className="row-sub">{freq ?? GROUP_LABEL[groupOf(s)]}{next && !s.lapsed ? ` · due ${date(next, "day")}` : ""}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="row-amount">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                            <Icon name="chev" size={16} className="chev" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {!adding && <button className="btn btn-ghost w-full" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> add a payment</button>}
          </>
        )}

        {!suggestionsTab && dismissed.length > 0 && (
          <section>
            <button className="text-[13px] text-muted hover:text-ink" onClick={() => setShowDismissed((v) => !v)} aria-expanded={showDismissed}>
              {showDismissed ? "Hide" : "Show"} {dismissed.length} you said aren&rsquo;t regular
            </button>
            {showDismissed && (
              <div className="panel mt-2">
                <ul className="rows">
                  {dismissed.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13.5px]">
                      <span className="min-w-0 truncate">{name(s)} <span className="num text-muted">· {money(s.amount, s.currency)}</span></span>
                      <button className="btn btn-quiet btn-sm" onClick={() => { updateSubscription(s.id, { status: "detected" }); logAction({ kind: "restored", title: `Moved back to check: ${name(s)}`, href: "/review" }); }}>Check again</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
