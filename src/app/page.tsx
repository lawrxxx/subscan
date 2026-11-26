"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { duplicates, monthlyEquivalent, priceChanges, spendSummary, toHome, upcomingRenewals } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { date, FREQ_LABEL, money, moneyParts, PER, relDays } from "@/lib/format";
import type { Subscription } from "@/lib/types";
import { Confidence, StatusTag } from "@/components/bits";

type Filter = "all" | "review" | "confirmed" | "dismissed";

export default function Overview() {
  const { state, ready, updateSubscription } = useStore();
  const home = state.settings.homeCurrency;
  const { rates, asOf, error: rateError } = useRates(home);
  const today = new Date().toISOString().slice(0, 10);
  const [filter, setFilter] = useState<Filter>("all");

  const subs = state.subscriptions;
  const summary = useMemo(() => spendSummary(subs, home, rates), [subs, home, rates]);
  const renewals = useMemo(() => upcomingRenewals(subs, today, 30), [subs, today]);
  const changes = useMemo(() => priceChanges(subs), [subs]);
  const dupes = useMemo(() => duplicates(subs), [subs]);
  const reviewCount = subs.filter((s) => s.status === "detected").length;

  if (!ready) return <div className="px-12 py-16 text-muted">Loading…</div>;
  if (!subs.length) return <Empty />;

  const list = subs
    .filter((s) => (filter === "all" ? s.status !== "dismissed" : filter === "review" ? s.status === "detected" : s.status === filter))
    .sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal));

  const headline = summary.monthlyHome ?? summary.byCurrency[0]?.monthly ?? 0;
  const headlineCcy = summary.monthlyHome !== null ? home : summary.byCurrency[0]?.currency ?? home;
  const parts = moneyParts(headline, headlineCcy);
  const next = renewals[0];

  return (
    <div>
      {/* Masthead */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b rule px-4 py-4 text-[12px] text-muted sm:px-8 lg:px-12">
        <span className="kicker">{date(today, "long")}</span>
        <span>
          {state.dataSource === "sample" ? "Sample statement" : "Imported statement"} · {state.transactions.length} payments ·{" "}
          <Link href="/onboarding" className="link">Re-import</Link>
        </span>
      </div>

      {/* Hero */}
      <section className="grid border-b rule lg:grid-cols-[1.35fr_1fr]">
        <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12 lg:py-14">
          <div className="kicker mb-4">Monthly recurring spend</div>
          <div className="figure flex items-start text-[76px] sm:text-[120px] xl:text-[148px]">
            <span className="mt-[0.12em] mr-1 text-[0.45em] text-muted">{parts.sym}</span>
            {parts.int}
            {parts.frac && <span className="mt-[0.12em] text-[0.35em] text-muted">.{parts.frac}</span>}
          </div>
          <div className="mt-6 grid max-w-xl grid-cols-3 border-t rule pt-4 text-[13px]">
            <div>
              <div className="text-muted">Per year</div>
              <div className="num mt-1 text-[17px]">{money(headline * 12, headlineCcy)}</div>
            </div>
            <div>
              <div className="text-muted">Active</div>
              <div className="num mt-1 text-[17px]">{summary.activeCount}</div>
            </div>
            <div>
              <div className="text-muted">Need review</div>
              <div className="num mt-1 text-[17px]">{reviewCount}</div>
            </div>
          </div>
          <p className="mt-5 max-w-xl text-[12px] leading-relaxed text-muted">
            {summary.byCurrency.map((c) => `${money(c.monthly, c.currency)}/mo in ${c.currency} (${c.count})`).join(" · ")}
            {summary.monthlyHome !== null && summary.byCurrency.length > 1 && rates.USD && (
              <> · USD converted at ₦{rates.USD.toFixed(2)} from a live Textile FX quote{asOf ? `, ${new Date(asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}.</>
            )}
            {summary.unconverted.length > 0 && <> · {summary.unconverted.join(", ")} not included in the headline{rateError ? " (FX rate unavailable)" : ""}.</>}
          </p>
        </div>

        <div className="bg-paper-2/60 px-4 py-10 sm:px-8 lg:px-10 lg:py-14">
          <div className="kicker mb-4">Next to renew</div>
          {next ? (
            <>
              <div className="display text-[34px]">{next.displayName}</div>
              <div className="mt-1 text-[14px] text-muted">{next.category} · {FREQ_LABEL[next.frequency]}</div>
              <div className="mt-8 flex items-end justify-between border-t rule pt-4">
                <div>
                  <div className="figure text-[54px]">{date(next.nextRenewal, "day")}</div>
                  <div className="mt-1 text-[13px] text-muted">{relDays(next.daysUntil)} · estimated</div>
                </div>
                <div className="text-right">
                  <div className="num text-[22px]">{money(next.amount, next.currency)}</div>
                  {next.international && <div className="text-[12px] text-muted">billed in {next.currency}</div>}
                </div>
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={`/pay/${encodeURIComponent(next.id)}`} className="btn btn-primary">Prepare payment</Link>
                <Link href={`/subscriptions/${encodeURIComponent(next.id)}`} className="btn btn-ghost">Details</Link>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-muted">Nothing renews in the next 30 days.</p>
          )}
        </div>
      </section>

      {/* Renewal calendar */}
      {renewals.length > 1 && (
        <section className="border-b rule px-4 py-8 sm:px-8 lg:px-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="display text-[24px]">The next thirty days</h2>
            <span className="text-[12px] text-muted">{renewals.length} renewals · {money(renewals.filter((r) => r.currency === home).reduce((s, r) => s + r.amount, 0), home)} in {home}</span>
          </div>
          <ol className="-mx-1 flex gap-px overflow-x-auto pb-1">
            {renewals.map((r) => (
              <li key={r.id} className="min-w-[148px] flex-1 border-t-2 border-ink/80 bg-paper-2/50 px-3 py-3 first:border-accent">
                <Link href={`/subscriptions/${encodeURIComponent(r.id)}`} className="block">
                  <div className="num text-[11px] text-muted">{relDays(r.daysUntil)}</div>
                  <div className="figure mt-1 text-[30px]">{date(r.nextRenewal, "day")}</div>
                  <div className="mt-2 truncate text-[13px] font-medium">{r.displayName}</div>
                  <div className="num text-[12px] text-muted">{money(r.amount, r.currency)}</div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Ledger + notes */}
      <section className="grid xl:grid-cols-[1fr_320px]">
        <div className="px-4 py-8 sm:px-8 lg:px-12 xl:border-r xl:rule">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="display text-[30px]">Ledger</h2>
            <div className="flex gap-px text-[13px]" role="tablist">
              {(
                [
                  ["all", "Active"],
                  ["review", `Needs review${reviewCount ? ` (${reviewCount})` : ""}`],
                  ["confirmed", "Confirmed"],
                  ["dismissed", "Dismissed"],
                ] as [Filter, string][]
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`border-b-2 px-2.5 py-1.5 ${filter === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <Ledger list={list} home={home} rates={rates} onStatus={(id, status) => updateSubscription(id, { status })} />
        </div>

        <aside className="border-t rule px-4 py-8 sm:px-8 lg:px-12 xl:border-t-0 xl:px-8">
          <h2 className="kicker mb-4">Notes from your statement</h2>
          <div className="space-y-8">
            <Note title="Price changes" empty="No price changes detected.">
              {changes.slice(0, 4).map((s) => (
                <Link key={s.id} href={`/subscriptions/${encodeURIComponent(s.id)}`} className="block border-t rule py-3 first:border-t-0 first:pt-0">
                  <div className="flex items-baseline justify-between text-[14px]">
                    <span className="font-medium">{s.displayName}</span>
                    <span className={`num text-[13px] ${s.priceChange!.pct > 0 ? "text-alert" : "text-accent"}`}>{s.priceChange!.pct > 0 ? "+" : ""}{Math.round(s.priceChange!.pct * 100)}%</span>
                  </div>
                  <div className="num text-[12px] text-muted">{money(s.priceChange!.from, s.currency)} → {money(s.priceChange!.to, s.currency)} on {date(s.priceChange!.date)}</div>
                </Link>
              ))}
            </Note>
            <Note title="Possible overlaps" empty="No duplicate or overlapping services.">
              {dupes.map((g) => (
                <div key={g.reason} className="border-t rule py-3 first:border-t-0 first:pt-0">
                  <div className="text-[14px]">{g.reason}</div>
                  <div className="mt-0.5 text-[12px] text-muted">{g.subscriptions.map((s) => s.displayName).join(", ")}</div>
                </div>
              ))}
            </Note>
            {summary.byCategory.length > 0 && (
              <Note title={`Where it goes (${home}/mo)`} empty="">
                <ul className="space-y-1.5">
                  {summary.byCategory.slice(0, 6).map((c) => {
                    const max = summary.byCategory[0].monthlyHome;
                    return (
                      <li key={c.category} className="text-[13px]">
                        <div className="flex justify-between"><span>{c.category}</span><span className="num text-muted">{money(c.monthlyHome, home)}</span></div>
                        <div className="mt-1 h-[3px] bg-stone"><div className="h-full bg-ink/70" style={{ width: `${(c.monthlyHome / max) * 100}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              </Note>
            )}
            <Link href="/agent" className="block border border-ink px-4 py-4 hover:bg-paper-2">
              <div className="kicker mb-1 text-accent">Agent</div>
              <div className="display text-[20px]">“Which subscriptions am I wasting money on?”</div>
              <div className="mt-2 text-[12px] text-muted">Ask about your spend, renewals and payments →</div>
            </Link>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Note({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <h3 className="display mb-3 text-[19px]">{title}</h3>
      {has ? children : <p className="text-[13px] text-muted">{empty}</p>}
    </div>
  );
}

function Ledger({ list, home, rates, onStatus }: { list: Subscription[]; home: string; rates: Record<string, number>; onStatus(id: string, s: Subscription["status"]): void }) {
  if (!list.length) return <p className="border-t rule py-8 text-[14px] text-muted">Nothing here.</p>;
  return (
    <div className="border-t border-ink">
      <div className="hidden grid-cols-[1.6fr_0.8fr_0.9fr_0.9fr_0.9fr_0.7fr_150px] gap-4 border-b rule py-2 text-[11px] uppercase tracking-[0.1em] text-muted md:grid">
        <span>Merchant</span>
        <span>Cadence</span>
        <span>Next renewal</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Per year ({home})</span>
        <span>Confidence</span>
        <span className="text-right">Status</span>
      </div>
      <ul>
        {list.map((s) => {
          const yearly = toHome(monthlyEquivalent(s) * 12, s.currency, home, rates);
          return (
            <li key={s.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b rule py-3.5 md:grid-cols-[1.6fr_0.8fr_0.9fr_0.9fr_0.9fr_0.7fr_150px] md:items-center">
              <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="min-w-0">
                <div className="truncate text-[15px] font-medium hover:underline">{s.displayName}</div>
                <div className="text-[12px] text-muted">
                  {s.category}
                  {s.international && <> · <span className="text-ink-2">{s.currency}</span></>}
                  {s.priceChange && s.priceChange.pct > 0 && <> · <span className="text-alert">price up</span></>}
                </div>
              </Link>
              <div className="num text-right text-[15px] md:hidden">{money(s.amount, s.currency)}<span className="text-muted">{PER[s.frequency]}</span></div>
              <span className="hidden text-[13px] md:block">{FREQ_LABEL[s.frequency]}</span>
              <span className="num text-[12px] text-muted md:text-[13px] md:text-ink">{date(s.nextRenewal)}</span>
              <span className="num hidden text-right text-[14px] md:block">{money(s.amount, s.currency)}</span>
              <span className="num hidden text-right text-[13px] text-muted md:block">{yearly === null ? "—" : money(yearly, home)}</span>
              <span className="hidden md:block"><Confidence value={s.confidence} /></span>
              <div className="col-span-2 flex items-center justify-start gap-2 md:col-span-1 md:justify-end">
                {s.status === "detected" ? (
                  <>
                    <button onClick={() => onStatus(s.id, "confirmed")} className="tag hover:border-accent hover:text-accent">Confirm</button>
                    <button onClick={() => onStatus(s.id, "dismissed")} className="tag hover:border-alert hover:text-alert">Dismiss</button>
                  </>
                ) : (
                  <>
                    <StatusTag status={s.status} />
                    <button onClick={() => onStatus(s.id, "detected")} className="text-[11px] text-muted link">undo</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Empty() {
  return (
    <div className="px-4 py-16 sm:px-8 lg:px-12 lg:py-24">
      <div className="kicker mb-4">Overview</div>
      <h1 className="display max-w-2xl text-[46px] sm:text-[64px]">No statement yet.</h1>
      <p className="mt-4 max-w-md text-[16px] text-muted">Import a CSV from your bank or card and subscan will find the payments that repeat.</p>
      <Link href="/onboarding" className="btn btn-primary mt-8">Import a statement</Link>
    </div>
  );
}
