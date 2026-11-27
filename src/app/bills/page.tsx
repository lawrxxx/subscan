"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { commitments, monthlyEquivalent, toHome } from "@/lib/detection/analysis";
import { KIND_LABEL } from "@/lib/detection/merchants";
import { useRates, useStore } from "@/lib/db/store";
import { date, FREQ_LABEL, money } from "@/lib/format";
import type { Frequency, ObligationKind, Subscription } from "@/lib/types";
import { AddBill } from "@/components/add-bill";
import { Avatar, BillStatus, RecurrenceText, EmptyPanel, Icon, PageBar, UploadButton } from "@/components/ui";

type View = "all" | "review" | ObligationKind | "dismissed";
type Sort = "due" | "amount" | "name";

export default function Bills() {
  const router = useRouter();
  const { state, ready, updateSubscription, addManual, logAction } = useStore();
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [freq, setFreq] = useState<"all" | Frequency>("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<Sort>("due");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("view") === "review") setView("review");
    if (p.get("add")) setAdding(true);
  }, []);

  const subs = state.subscriptions;
  const live = subs.filter((s) => s.status !== "dismissed");
  const c = useMemo(() => commitments(subs, home, rates), [subs, home, rates]);
  const counts: Record<View, number> = {
    all: live.length,
    review: live.filter((s) => s.status === "detected").length,
    subscription: live.filter((s) => (s.kind ?? "subscription") === "subscription").length,
    utility: live.filter((s) => s.kind === "utility").length,
    obligation: live.filter((s) => s.kind === "obligation").length,
    dismissed: subs.filter((s) => s.status === "dismissed").length,
  };
  const categories = useMemo(() => [...new Set(live.map((s) => s.category))].sort(), [live]);

  const list = useMemo(() => {
    const yearly = (s: Subscription) => toHome(monthlyEquivalent(s), s.currency, home, rates) ?? 0;
    return subs
      .filter((s) => (view === "dismissed" ? s.status === "dismissed" : s.status !== "dismissed"))
      .filter((s) => (view === "review" ? s.status === "detected" : view === "all" || view === "dismissed" ? true : (s.kind ?? "subscription") === view))
      .filter((s) => freq === "all" || s.frequency === freq)
      .filter((s) => category === "all" || s.category === category)
      .filter((s) => !q || `${s.displayName} ${s.category} ${s.merchant}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (sort === "amount" ? yearly(b) - yearly(a) : sort === "name" ? a.displayName.localeCompare(b.displayName) : (a.missed ? -1 : 0) - (b.missed ? -1 : 0) || a.nextRenewal.localeCompare(b.nextRenewal)));
  }, [subs, view, freq, category, q, sort, home, rates]);

  if (!ready) return null;

  const setStatus = (s: Subscription, status: Subscription["status"]) => {
    updateSubscription(s.id, { status });
    logAction({ kind: status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "restored", title: `${status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Dismissed" : "Restored"} ${s.displayName}`, href: `/bills/${encodeURIComponent(s.id)}` });
  };

  return (
    <div>
      <PageBar
        title="Bills"
        sub={live.length ? <>{live.length} recurring payment{live.length === 1 ? "" : "s"} · {c.monthlyHome !== null ? `${money(c.monthlyHome, home)} a month committed` : "mixed currencies"}</> : "Subscriptions, utilities and other regular payments"}
        actions={
          subs.length > 0 && (
            <>
              <button className="btn btn-ghost" onClick={() => setAdding(true)}>Add bill</button>
              <UploadButton className="btn btn-primary" />
            </>
          )
        }
      >
        {subs.length > 0 && <div className="tabs mt-4" role="tablist">
          {(
            [
              ["all", "All"],
              ["review", "Needs review"],
              ["subscription", "Subscriptions"],
              ["utility", "Utilities"],
              ["obligation", "Other obligations"],
              ["dismissed", "Dismissed"],
            ] as [View, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}>
              {l}
              <span className={`count ${k === "review" && counts.review ? "!bg-amber-wash !text-amber" : ""}`}>{counts[k]}</span>
            </button>
          ))}
        </div>}
      </PageBar>

      <div className="space-y-4 px-4 sm:px-6 lg:px-8">
        {adding && <AddBill home={home} onCancel={() => setAdding(false)} onAdd={(s) => { addManual(s); setAdding(false); setView("all"); }} />}

        <section className="panel">
          {subs.length > 0 && <div className="flex flex-col gap-2 border-b rule px-3 py-2.5 md:flex-row md:items-center">
            <label className="relative flex-1">
              <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
              <input className="input pl-8" placeholder="Search bills" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
            </label>
            <div className="flex flex-wrap gap-2">
              <select className="input w-auto" value={freq} onChange={(e) => setFreq(e.target.value as "all" | Frequency)} aria-label="Billing frequency">
                <option value="all">Any frequency</option>
                {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="all">All categories</option>
                {categories.map((x) => <option key={x}>{x}</option>)}
              </select>
              <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="due">Sort: next due</option>
                <option value="amount">Sort: amount</option>
                <option value="name">Sort: name</option>
              </select>
            </div>
          </div>}

          {view === "review" && counts.review > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b rule bg-paper-2/40 px-4 py-2.5 text-[13px]">
              <span>Go through suggestions one at a time, with the dates and reasons for each.</span>
              <Link href="/review" className="btn btn-primary btn-sm">Review suggestions</Link>
            </div>
          )}

          {!subs.length ? (
            state.transactions.length ? (
              <EmptyPanel icon="bills" title="No recurring payments found in your statement" action={<div className="flex flex-wrap justify-center gap-2"><UploadButton label="Upload more months" /><button className="btn btn-ghost" onClick={() => setAdding(true)}>Add a bill yourself</button></div>}>
                Bills need at least two charges to be spotted. Upload more months, or add one you know about.
              </EmptyPanel>
            ) : (
              <EmptyPanel icon="upload" title="No bills yet" action={<div className="flex flex-wrap justify-center gap-2"><UploadButton /><button className="btn btn-ghost" onClick={() => setAdding(true)}>Add one yourself</button></div>}>Upload a bank or card statement to find your subscriptions, utilities and other regular payments.</EmptyPanel>
            )
          ) : !list.length ? (
            <EmptyPanel icon="search" title={q ? `Nothing matches “${q}”` : view === "review" ? "Nothing to review" : "Nothing in this view"}>{view === "review" ? "Every detected bill has been confirmed or dismissed." : undefined}</EmptyPanel>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th className="hidden lg:table-cell">Type</th>
                    <th className="hidden md:table-cell">Frequency</th>
                    <th className="hidden sm:table-cell">Next due</th>
                    <th className="r">Amount</th>
                    <th className="hidden xl:table-cell">Evidence</th>
                    <th className="hidden sm:table-cell">Status</th>
                    <th className="r hidden sm:table-cell"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} data-href onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) router.push(`/bills/${encodeURIComponent(s.id)}`); }}>
                      <td>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={s.displayName} />
                          <div className="min-w-0">
                            <Link href={`/bills/${encodeURIComponent(s.id)}`} className="block truncate font-medium hover:underline">{s.displayName}</Link>
                            <div className="truncate text-[12px] text-muted">
                              {s.category}
                              {s.billType === "variable" && " · varies"}
                              {s.manual && " · added by you"}
                              {s.priceChange && s.priceChange.pct > 0 && <span className="text-alert"> · up {Math.round(s.priceChange.pct * 100)}%</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden text-muted lg:table-cell">{KIND_LABEL[s.kind ?? "subscription"]}</td>
                      <td className="hidden text-muted md:table-cell">{FREQ_LABEL[s.frequency]}</td>
                      <td className={`hidden whitespace-nowrap num sm:table-cell ${s.missed ? "text-alert" : s.lapsed ? "text-faint line-through" : ""}`}>{s.missed ? "Overdue?" : date(s.nextRenewal)}</td>
                      <td className="r whitespace-nowrap">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}<div className={`text-[12px] sm:hidden ${s.missed ? "text-alert" : s.status === "detected" ? "text-amber" : "text-muted"}`}>{s.missed ? "Overdue?" : s.status === "detected" ? "Needs review" : date(s.nextRenewal)}</div></td>
                      <td className="hidden xl:table-cell">{s.manual ? <span className="text-[12px] text-muted">You added</span> : <RecurrenceText s={s} />}</td>
                      <td className="hidden sm:table-cell"><BillStatus s={s} /></td>
                      <td className="r hidden whitespace-nowrap sm:table-cell">
                        {s.status === "detected" ? (
                          <span className="inline-flex gap-1.5">
                            <button className="btn btn-ghost btn-sm" onClick={() => setStatus(s, "confirmed")} aria-label={`Confirm ${s.displayName}`}>Confirm</button>
                            <button className="btn btn-quiet btn-sm" onClick={() => setStatus(s, "dismissed")} aria-label={`Dismiss ${s.displayName}`}>Dismiss</button>
                          </span>
                        ) : s.status === "dismissed" ? (
                          <button className="btn btn-quiet btn-sm" onClick={() => setStatus(s, "detected")}>Restore</button>
                        ) : (
                          <Icon name="arrow" size={15} className="inline text-faint" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {live.length > 0 && (
          <p className="text-[12px] text-muted">
            Due dates are estimated from your billing history. ≈ marks usage-based bills shown at their typical amount{rates.USD ? `; dollar bills converted at ₦${rates.USD.toFixed(2)} (live Textile FX)` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
