"use client";
import { useMemo, useState } from "react";
import { monthlyEquivalent, spendSummary, toHome } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { money } from "@/lib/format";
import type { Subscription } from "@/lib/types";
import { Ledger } from "@/components/ledger";
import { NoData } from "@/components/empty";
import { PageHeader } from "@/components/shell";
import { AddBill } from "@/components/add-bill";
import { KIND_LABEL, KIND_PLURAL } from "@/lib/detection/merchants";
import type { ObligationKind } from "@/lib/types";

type Status = "active" | "review" | "confirmed" | "dismissed";
type Sort = "renewal" | "cost" | "name" | "confidence";

export default function Subscriptions() {
  const { state, ready, updateSubscription, addManual } = useStore();
  const [kind, setKind] = useState<"all" | ObligationKind>("all");
  const [adding, setAdding] = useState(false);
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const [status, setStatus] = useState<Status>("active");
  const [sort, setSort] = useState<Sort>("renewal");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [intlOnly, setIntlOnly] = useState(false);

  const subs = state.subscriptions;
  const categories = useMemo(() => [...new Set(subs.map((s) => s.category))].sort(), [subs]);
  const counts = useMemo(
    () => ({
      active: subs.filter((s) => s.status !== "dismissed").length,
      review: subs.filter((s) => s.status === "detected").length,
      confirmed: subs.filter((s) => s.status === "confirmed").length,
      dismissed: subs.filter((s) => s.status === "dismissed").length,
    }),
    [subs],
  );

  const list = useMemo(() => {
    const yearlyHome = (s: Subscription) => toHome(monthlyEquivalent(s) * 12, s.currency, home, rates) ?? 0;
    return subs
      .filter((s) => (status === "active" ? s.status !== "dismissed" : status === "review" ? s.status === "detected" : s.status === status))
      .filter((s) => kind === "all" || (s.kind ?? "subscription") === kind)
      .filter((s) => category === "all" || s.category === category)
      .filter((s) => !intlOnly || s.international)
      .filter((s) => !q || `${s.displayName} ${s.category} ${s.merchant}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) =>
        sort === "cost" ? yearlyHome(b) - yearlyHome(a) : sort === "name" ? a.displayName.localeCompare(b.displayName) : sort === "confidence" ? b.confidence - a.confidence : a.nextRenewal.localeCompare(b.nextRenewal),
      );
  }, [subs, status, kind, category, intlOnly, q, sort, home, rates]);

  const shown = spendSummary(list.filter((s) => s.status !== "dismissed"), home, rates);

  if (!ready) return null;
  if (!subs.length && !state.transactions.length) return <NoData kicker="Bills & subscriptions" title="No bills yet.">Upload a statement to find your subscriptions, utility bills and other regular payments — or switch on demo mode to look around.</NoData>;

  const reviewIds = list.filter((s) => s.status === "detected" && s.confidence >= 0.85).map((s) => s.id);

  return (
    <div>
      <PageHeader
        kicker="Bills & subscriptions"
        title={<>{counts.active} recurring <span className="italic">payments</span></>}
        aside={
          <div className="text-left md:text-right">
            <div className="kicker mb-1">Shown · per month</div>
            <div className="figure text-[44px]">{shown.monthlyHome !== null ? money(shown.monthlyHome, home) : money(shown.byCurrency[0]?.monthly ?? 0, shown.byCurrency[0]?.currency ?? home)}</div>
          </div>
        }
      >
        Subscriptions, utility bills and other regular payments found in your {state.dataSource === "sample" ? "sample" : ""} statement. Confirm the real ones, dismiss the rest, or add a bill that isn&rsquo;t in your statement.
      </PageHeader>

      {/* Filter bar */}
      <div className="sticky top-[57px] z-10 border-b rule bg-paper/95 px-4 py-3 backdrop-blur sm:px-8 lg:top-0 lg:px-12">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-1 flex gap-px overflow-x-auto text-[13px]" role="tablist">
            {(
              [
                ["active", "Active"],
                ["review", "Needs review"],
                ["confirmed", "Confirmed"],
                ["dismissed", "Dismissed"],
              ] as [Status, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={status === k}
                onClick={() => setStatus(k)}
                className={`whitespace-nowrap border-b-2 px-2.5 py-1.5 ${status === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {l} <span className="num text-faint">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="field h-9 w-full sm:w-52" placeholder="Search merchants" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search merchants" />
            <select className="field h-9 w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="field h-9 w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="renewal">Next renewal</option>
              <option value="cost">Annual cost</option>
              <option value="confidence">Confidence</option>
              <option value="name">Name</option>
            </select>
            <label className="flex h-9 items-center gap-2 border rule px-3 text-[13px]">
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={intlOnly} onChange={(e) => setIntlOnly(e.target.checked)} />
              Foreign currency
            </label>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 sm:px-8 lg:px-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-px text-[13px]" role="group" aria-label="Filter by type">
            {(["all", "subscription", "utility", "obligation"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`border px-3 py-1.5 ${kind === k ? "border-ink bg-ink text-paper" : "rule text-muted hover:text-ink"}`}>
                {k === "all" ? "All" : `${KIND_PLURAL[k]}`}
              </button>
            ))}
          </div>
          {!adding && <button className="btn btn-ghost h-9" onClick={() => setAdding(true)}>+ Add a bill</button>}
        </div>
        {adding && (
          <div className="mb-6">
            <AddBill home={home} onCancel={() => setAdding(false)} onAdd={(sub) => { addManual(sub); setAdding(false); setStatus("active"); }} />
          </div>
        )}
        {status === "review" && reviewIds.length > 1 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-l-2 border-accent bg-accent-wash/50 px-4 py-3 text-[13px]">
            <span>{reviewIds.length} detections have 85%+ confidence.</span>
            <button className="btn btn-ghost h-8 bg-paper" onClick={() => reviewIds.forEach((id) => updateSubscription(id, { status: "confirmed" }))}>Confirm all {reviewIds.length}</button>
          </div>
        )}
        <Ledger list={list} home={home} rates={rates} onStatus={(id, s) => updateSubscription(id, { status: s })} empty={q ? `Nothing matches “${q}”.` : !subs.length ? "No recurring payments were found in your statement. If you pay a bill that didn’t show up, add it yourself." : "Nothing in this view."} />
        <p className="mt-4 text-[12px] text-muted">
          {list.length} shown · amounts in billing currency; yearly totals in {home}
          {rates.USD ? ` (USD at ₦${rates.USD.toFixed(2)}, live Textile FX)` : ""}.
        </p>
      </div>
    </div>
  );
}
