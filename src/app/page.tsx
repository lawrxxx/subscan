"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { attentionItems, dueIn, spendingByCategory } from "@/lib/attention";
import { commitments, income, savingsPotential, toHome, upcomingRenewals } from "@/lib/detection/analysis";
import { KIND_PLURAL } from "@/lib/detection/merchants";
import { useRates, useStore } from "@/lib/db/store";
import { date, money, readableDates } from "@/lib/format";
import { setPendingUpload } from "@/lib/import/pending";
import type { ObligationKind, Subscription } from "@/lib/types";
import { Avatar, BillStatus, EmptyPanel, Icon, PageBar, Stat, UploadButton } from "@/components/ui";

const KINDS: ObligationKind[] = ["subscription", "utility", "obligation"];
const KIND_COLOR: Record<ObligationKind, string> = { subscription: "bg-ink", utility: "bg-[#8a8475]", obligation: "bg-accent" };

export default function Overview() {
  const { state, ready } = useStore();
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const today = new Date().toISOString().slice(0, 10);
  const subs = state.subscriptions;

  const c = useMemo(() => commitments(subs, home, rates), [subs, home, rates]);
  const inc = useMemo(() => income(state.transactions, home, today), [state.transactions, home, today]);
  const upcoming = useMemo(() => upcomingRenewals(subs, today, 30), [subs, today]);
  const savings = useMemo(() => savingsPotential(subs, home, rates, today), [subs, home, rates, today]);
  const attention = useMemo(() => attentionItems(state, today), [state, today]);
  const spend = useMemo(() => spendingByCategory(state, home), [state, home]);

  if (!ready) return null;
  if (!state.transactions.length && !subs.length) return <FirstRun />;

  const live = subs.filter((s) => s.status !== "dismissed");
  const dates = state.transactions.map((t) => t.date).sort();
  const spanDays = dates.length ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000) : 0;
  const thin = state.transactions.length < 20 || spanDays < 75;
  const unconfirmed = live.filter((s) => s.status === "detected").length;
  const monthly = c.monthlyHome ?? 0;
  const missed = live.filter((s) => s.missed && !s.lapsed);
  const due = [...missed, ...upcoming.filter((u) => !missed.some((m) => m.id === u.id))];
  const homeAmt = (s: Subscription) => toHome(s.amount, s.currency, home, rates) ?? 0;
  const dueTotal = upcoming.reduce((x, s) => x + homeAmt(s), 0);
  const share = inc.monthlyRecurring ? monthly / inc.monthlyRecurring : null;
  const estimate = thin || unconfirmed > 0;

  return (
    <div>
      <PageBar
        title="Overview"
        sub={<>{state.imports?.length ?? 0} statement{(state.imports?.length ?? 0) === 1 ? "" : "s"} · {state.transactions.length} transactions{dates.length ? ` · ${date(dates[0])} – ${date(dates[dates.length - 1])}` : ""}</>}
        actions={
          <>
            <Link href="/agent" className="btn btn-ghost">Ask agent</Link>
            <UploadButton label="Upload statement" className="btn btn-ghost" />
          </>
        }
      />

      <div className="space-y-5 px-4 sm:px-6 lg:px-8">
        {!live.length ? (
          <NoRecurring spanDays={spanDays} />
        ) : (
          <>
            {/* Key figures */}
            <section className="panel grid grid-cols-2 lg:grid-cols-4 [&>*]:border-rule max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r">
              <Stat
                label={<>Committed each month{estimate && <span className="pill pill-plain pill-amber ml-1.5">Estimate</span>}</>}
                value={money(monthly, home)}
                sub={share !== null ? `${Math.round(share * 100)}% of regular income` : `${money(monthly * 12, home)} a year`}
              />
              <Stat label="Due in the next 30 days" value={money(dueTotal, home)} sub={`${upcoming.length} payment${upcoming.length === 1 ? "" : "s"}${missed.length ? ` · ${missed.length} missed` : ""}`} tone={missed.length ? "alert" : undefined} />
              <Stat label="Next payday" value={inc.nextPayday ? date(inc.nextPayday) : "—"} sub={inc.nextPayday ? `${money(inc.monthlyRecurring, home)} regular income` : "No regular income found"} />
              <Stat label="Could save" value={savings.monthly ? `${money(savings.monthly, home)}/mo` : "—"} sub={savings.flags.length ? `${savings.flags.length} suggestion${savings.flags.length === 1 ? "" : "s"}` : "Nothing obvious to cut"} tone={savings.monthly ? "accent" : undefined} />
            </section>

            {/* Commitment composition */}
            <section className="panel px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                <span className="font-medium">Where your committed money goes</span>
                <span className="text-muted">Fixed {money(c.fixedMonthly, home)} · usage-based {money(c.variableMonthly, home)}</span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                {KINDS.map((k) => <div key={k} className={KIND_COLOR[k]} style={{ width: `${monthly ? (c.byKind[k].monthly / monthly) * 100 : 0}%` }} />)}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
                {KINDS.map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${KIND_COLOR[k]}`} />
                    {KIND_PLURAL[k]} <span className="num text-muted">{money(c.byKind[k].monthly, home)}</span>
                  </span>
                ))}
              </div>
              {estimate && (
                <p className="mt-2.5 border-t rule pt-2.5 text-[12px] text-muted">
                  {thin && <>Based on {state.transactions.length} transactions over {spanDays} days — figures are rough until you upload 3+ months. </>}
                  {unconfirmed > 0 && <>Includes {unconfirmed} detected bill{unconfirmed === 1 ? "" : "s"} you haven&rsquo;t confirmed. <Link href="/bills?view=review" className="link">Review</Link></>}
                </p>
              )}
            </section>
          </>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
          <div className="min-w-0 space-y-5">
            {live.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <span className="panel-title">Upcoming payments</span>
                  <Link href="/bills" className="text-[12.5px] text-muted hover:text-ink">All bills →</Link>
                </div>
                {due.length ? (
                  <table className="tbl">
                    <thead>
                      <tr><th>Due</th><th>Payee</th><th className="hidden sm:table-cell">Category</th><th className="r">Amount</th><th className="hidden md:table-cell">Status</th></tr>
                    </thead>
                    <tbody>
                      {due.slice(0, 7).map((s) => {
                        const d = dueIn(s, today);
                        return (
                          <tr key={s.id}>
                            <td className={`whitespace-nowrap num ${s.missed ? "text-alert" : d <= 3 ? "font-medium" : "text-muted"}`}>{s.missed ? "Overdue?" : d === 0 ? "Today" : d === 1 ? "Tomorrow" : date(s.nextRenewal, "day")}</td>
                            <td>
                              <Link href={`/bills/${encodeURIComponent(s.id)}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                                <Avatar name={s.displayName} size={26} />
                                <span className="truncate font-medium">{s.displayName}</span>
                              </Link>
                            </td>
                            <td className="hidden text-muted sm:table-cell">{s.category}</td>
                            <td className="r whitespace-nowrap">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</td>
                            <td className="hidden md:table-cell"><BillStatus s={s} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <EmptyPanel icon="clock" title="Nothing due in the next 30 days" />
                )}
              </section>
            )}

            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">Spending by category</span>
                <span className="text-[12px] text-muted">{spend.months ? `Monthly average · last ${spend.months} months` : ""}</span>
              </div>
              {spend.categories.length ? (
                <div className="px-4 py-3 sm:px-5">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="figure text-[22px]">{money(spend.monthlyTotal, home)}<span className="ml-1 text-[13px] font-normal text-muted">out per month</span></span>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><span className="h-2 w-2 rounded-full bg-accent" />Bills · {Math.round(spend.recurringShare * 100)}% of spending</span>
                  </div>
                  <ul className="space-y-2.5">
                    {spend.categories.slice(0, 8).map((cat) => (
                      <li key={cat.category} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-[13px]">
                        <span className="flex items-center gap-2">{cat.category}</span>
                        <span className="num text-right">{money(cat.monthly, home)}</span>
                        <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-paper-2"><span className={`block h-full rounded-full ${cat.recurring ? "bg-accent" : "bg-[#b5ae9f]"}`} style={{ width: `${(cat.monthly / spend.categories[0].monthly) * 100}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyPanel icon="activity" title="No money-out transactions in your home currency" />
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">Recent activity</span>
                <Link href="/activity" className="text-[12.5px] text-muted hover:text-ink">All activity →</Link>
              </div>
              <table className="tbl table-fixed">
                <tbody>
                  {[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td className="w-[76px] whitespace-nowrap text-muted num">{date(t.date, "day")}</td>
                      <td className="truncate">{t.description}</td>
                      <td className={`r w-[112px] whitespace-nowrap ${t.direction === "credit" ? "text-accent" : ""}`}>{t.direction === "credit" ? "+" : "−"}{money(t.amount, t.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="order-first space-y-5 xl:order-none">
            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">Needs attention</span>
                {attention.length > 0 && <span className="count">{attention.length}</span>}
              </div>
              {attention.length ? (
                <ul>
                  {attention.slice(0, 7).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 border-b rule px-4 py-3 last:border-b-0">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "high" ? "bg-alert" : a.severity === "medium" ? "bg-amber" : "bg-info"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium">{a.title}</div>
                        <div className="text-[12.5px] text-muted">{readableDates(a.detail)}</div>
                      </div>
                      <Link href={a.href} className="btn btn-ghost btn-sm">{a.action}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyPanel icon="check" title="You’re all caught up" />
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <span className="panel-title flex items-center gap-2"><Icon name="agent" size={16} className="text-accent" />Agent suggestions</span>
                <Link href="/agent" className="text-[12.5px] text-muted hover:text-ink">Open agent →</Link>
              </div>
              <ul>
                {savings.flags.slice(0, 3).map((f) => (
                  <li key={f.subscriptionId} className="border-b rule px-4 py-3 last:border-b-0">
                    <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                      <span className="font-medium">Consider {f.name}</span>
                      <span className="num text-muted">{money(f.monthlyHome ?? f.monthly, f.monthlyHome !== null ? home : f.currency)}/mo</span>
                    </div>
                    <div className="text-[12.5px] text-muted">{readableDates(f.reason[0].toUpperCase() + f.reason.slice(1))}</div>
                  </li>
                ))}
                {inc.nextPayday && (
                  <li className="border-b rule px-4 py-3 last:border-b-0">
                    <div className="text-[13.5px] font-medium">Plan bills before payday</div>
                    <div className="text-[12.5px] text-muted">See what&rsquo;s due before {date(inc.nextPayday)} and how much is left.</div>
                    <Link href={`/agent?q=${encodeURIComponent("Help me organise my bills before payday")}`} className="mt-2 inline-flex text-[12.5px] font-medium text-accent">Ask the agent →</Link>
                  </li>
                )}
                {!savings.flags.length && !inc.nextPayday && <li className="px-4 py-4 text-[13px] text-muted">No suggestions yet.</li>}
              </ul>
            </section>

            <section className="panel">
              <div className="panel-head">
                <span className="panel-title">Statements</span>
                <Link href="/onboarding" className="text-[12.5px] text-muted hover:text-ink">Add →</Link>
              </div>
              <ul>
                {(state.imports ?? []).slice(0, 4).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 border-b rule px-4 py-2.5 text-[13px] last:border-b-0">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{i.fileName}</div>
                      <div className="text-[12px] text-muted">{i.from && i.to ? `${date(i.from)} – ${date(i.to)}` : i.format} · {i.rows} transactions</div>
                    </div>
                    <span className="shrink-0 text-[12px] text-faint">{date(i.at.slice(0, 10))}</span>
                  </li>
                ))}
                {!(state.imports ?? []).length && <li className="px-4 py-3 text-[13px] text-muted">No statements on record.</li>}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Brand-new user: one clear action, no figures, no filler. */
function FirstRun() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const pick = (f?: File | null) => {
    if (!f) return;
    setPendingUpload(f);
    router.push("/onboarding");
  };
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 lg:py-14">
      <div className="max-w-[640px]">
        <h1 className="display text-[30px] sm:text-[34px]">Welcome to subscan.</h1>
        <p className="mt-2 text-[15px] text-ink-2">Upload a bank or card statement and we&rsquo;ll find the bills and subscriptions in it, total what&rsquo;s committed each month and show what&rsquo;s due next.</p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`mt-6 flex flex-col gap-3 rounded-[6px] border px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${drag ? "border-accent bg-accent-wash" : "border-dashed border-line-strong bg-surface"}`}
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{drag ? "Drop to read it" : "Upload a statement"}</div>
            <div className="text-[12.5px] text-muted">PDF from your bank or a CSV export · drag it here</div>
          </div>
          <button className="btn btn-primary shrink-0" onClick={() => input.current?.click()}>Choose file</button>
          <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Statement file" onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        <dl className="mt-8 divide-y divide-[var(--color-rule)] border-y rule text-[13.5px]">
          {[
            ["Subscriptions", "Streaming, software, memberships"],
            ["Utilities", "Electricity, internet, mobile data, TV"],
            ["Other obligations", "Rent, loan repayments, insurance"],
            ["For each one", "How much, how often, when it's next due, and price changes"],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2.5 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 flex items-start gap-2 text-[12.5px] text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          Your statement is read in this browser and never uploaded. Nothing is saved until you review it. subscan never asks for bank logins.
        </p>
      </div>
    </div>
  );
}

/** Statement imported, nothing recurring found. Explain — never invent bills. */
function NoRecurring({ spanDays }: { spanDays: number }) {
  const { state } = useStore();
  const dismissed = state.subscriptions.filter((s) => s.status === "dismissed").length;
  return (
    <section className="panel">
      <EmptyPanel
        icon="bills"
        title="No recurring payments found yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <UploadButton label="Upload more months" />
            <Link href="/bills?add=1" className="btn btn-ghost">Add a bill yourself</Link>
          </div>
        }
      >
        We read {state.transactions.length} transactions over {spanDays} days and didn&rsquo;t find payments that repeat on a schedule{dismissed ? ` (apart from ${dismissed} you dismissed)` : ""}. Bills need at least two charges to be spotted — 3 to 12 months of statements works best.
      </EmptyPanel>
    </section>
  );
}
