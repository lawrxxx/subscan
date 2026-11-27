"use client";
import Link from "next/link";
import { useMemo } from "react";
import { commitments, dueBefore, income, monthlyEquivalent, priceChanges, savingsPotential, toHome, upcomingRenewals } from "@/lib/detection/analysis";
import { KIND_LABEL, KIND_PLURAL } from "@/lib/detection/merchants";
import { useRates, useStore } from "@/lib/db/store";
import { date, daysUntil, FREQ_LABEL, money, moneyParts, relDays } from "@/lib/format";
import type { ObligationKind, Subscription } from "@/lib/types";
import { TxStatus } from "@/components/bits";
import { NoData } from "@/components/empty";
import { TOKENS } from "@/lib/celo/config";

const KINDS: ObligationKind[] = ["subscription", "utility", "obligation"];

export default function Overview() {
  const { state, ready } = useStore();
  const home = state.settings.homeCurrency;
  const { rates, asOf } = useRates(home);
  const today = new Date().toISOString().slice(0, 10);
  const subs = state.subscriptions;

  const c = useMemo(() => commitments(subs, home, rates), [subs, home, rates]);
  const inc = useMemo(() => income(state.transactions, home, today), [state.transactions, home, today]);
  const upcoming = useMemo(() => upcomingRenewals(subs, today, 30), [subs, today]);
  const missed = useMemo(() => subs.filter((s) => s.status !== "dismissed" && !s.lapsed && s.missed), [subs]);
  const savings = useMemo(() => savingsPotential(subs, home, rates, today), [subs, home, rates, today]);
  const changes = useMemo(() => priceChanges(subs), [subs]);
  const unusual = subs.filter((s) => s.status !== "dismissed" && s.unusual);
  const lapsed = subs.filter((s) => s.status !== "dismissed" && s.lapsed);
  const review = subs.filter((s) => s.status === "detected").length;
  const beforePayday = inc.nextPayday ? dueBefore(subs, today, inc.nextPayday) : [];

  if (!ready) return null;
  // 1. Brand-new user: nothing imported, nothing added → onboarding, no figures.
  if (!state.transactions.length && !subs.length) return <NoData kicker="Welcome to subscan" title="What is your money already committed to?">Upload a bank or card statement and subscan will find every subscription, utility bill and regular payment in it — then show what&rsquo;s due next and what you could cut.</NoData>;
  // 2. Statement imported but nothing recurring found → say so; don't invent bills.
  if (!subs.some((s) => s.status !== "dismissed")) return <NoRecurring />;

  // 3. Thin data → every figure is labelled as a rough estimate.
  const dates = state.transactions.map((t) => t.date).sort();
  const spanDays = dates.length ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000) : 0;
  const thin = state.transactions.length < 20 || spanDays < 75;
  const unconfirmed = subs.filter((s) => s.status === "detected").length;

  const monthly = c.monthlyHome ?? 0;
  const parts = moneyParts(monthly, home);
  const share = inc.monthlyRecurring ? monthly / inc.monthlyRecurring : null;
  const homeOf = (s: Subscription) => toHome(s.amount, s.currency, home, rates);
  const dueBeforeTotal = beforePayday.reduce((x, s) => x + (homeOf(s) ?? 0), 0);
  const urgent = missed[0] ?? upcoming[0];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b rule px-4 py-4 text-[12px] text-muted sm:px-8 lg:px-12">
        <span className="kicker">{date(today, "long")}</span>
        <span>
          {state.dataSource === "sample" ? "Demo sample statement" : `${state.imports?.length ?? 0} statement${(state.imports?.length ?? 0) === 1 ? "" : "s"}`} · {state.transactions.length} transactions{dates.length ? ` · ${date(dates[0])} – ${date(dates[dates.length - 1])}` : ""} ·{" "}
          <Link href="/onboarding" className="link">Upload another</Link>
        </span>
      </div>

      {/* Hero: committed money */}
      <section className="grid border-b rule lg:grid-cols-[1.35fr_1fr]">
        <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12 lg:py-14">
          <div className="kicker mb-4">Already committed every month{thin || unconfirmed ? " · estimate" : ""}</div>
          <div className="figure flex items-start text-[72px] sm:text-[116px] xl:text-[140px]">
            <span className="mt-[0.12em] mr-1 text-[0.45em] text-muted">{parts.sym}</span>
            {parts.int}
          </div>
          {share !== null && (
            <div className="mt-5 max-w-xl">
              <div className="flex items-baseline justify-between text-[14px]">
                <span><span className="num font-medium">{Math.round(share * 100)}%</span> of your regular income of {money(inc.monthlyRecurring, home)}</span>
                <span className="num text-muted">{money(Math.max(0, inc.monthlyRecurring - monthly), home)} left</span>
              </div>
              <div className="mt-2 flex h-[6px] bg-stone" aria-hidden>
                {KINDS.map((k) => (
                  <div key={k} className={k === "subscription" ? "bg-ink" : k === "utility" ? "bg-ink/60" : "bg-accent"} style={{ width: `${Math.min(100, (c.byKind[k].monthly / inc.monthlyRecurring) * 100)}%` }} />
                ))}
              </div>
            </div>
          )}
          <dl className="mt-6 grid max-w-xl grid-cols-2 gap-y-4 border-t rule pt-4 text-[13px] sm:grid-cols-4">
            <div><dt className="text-muted">Per year</dt><dd className="num mt-1 text-[17px]">{money(monthly * 12, home)}</dd></div>
            {KINDS.map((k) => (
              <div key={k}>
                <dt className="flex items-center gap-1.5 text-muted"><span className={`h-2 w-2 ${k === "subscription" ? "bg-ink" : k === "utility" ? "bg-ink/60" : "bg-accent"}`} />{KIND_PLURAL[k]}</dt>
                <dd className="num mt-1 text-[17px]">{money(c.byKind[k].monthly, home)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-xl text-[12px] text-muted">
            Fixed {money(c.fixedMonthly, home)} · variable (usage-based) {money(c.variableMonthly, home)}.
            {rates.USD && c.unconverted.length === 0 && <> Dollar bills converted at ₦{rates.USD.toFixed(2)} (live Textile FX{asOf ? `, ${new Date(asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}).</>}
            {c.unconverted.length > 0 && <> {c.unconverted.join(", ")} bills aren&rsquo;t in this total (no exchange rate).</>}
          </p>
          {(thin || unconfirmed > 0) && (
            <p className="mt-3 max-w-xl border-l-2 border-amber pl-3 text-[12px] text-ink-2">
              {thin && <>Based on {state.transactions.length} transactions over {spanDays} days, so these totals are rough — a bill needs at least two charges to be spotted. Upload 3+ months for a fuller picture. </>}
              {unconfirmed > 0 && <>Includes {unconfirmed} detected item{unconfirmed === 1 ? "" : "s"} you haven&rsquo;t confirmed yet.</>}
            </p>
          )}
        </div>

        <div className={`px-4 py-10 sm:px-8 lg:px-10 lg:py-14 ${missed.length ? "bg-alert-wash/40" : "bg-paper-2/60"}`}>
          <div className={`kicker mb-4 ${missed.length ? "text-alert" : ""}`}>{missed.length ? "Needs attention" : "Due next"}</div>
          {urgent ? (
            <>
              <div className="display text-[32px]">{urgent.displayName}</div>
              <div className="mt-1 text-[14px] text-muted">{KIND_LABEL[urgent.kind ?? "subscription"]} · {urgent.category} · {FREQ_LABEL[urgent.frequency]}</div>
              <div className="mt-8 flex items-end justify-between border-t rule pt-4">
                <div>
                  <div className="figure text-[52px]">{date(urgent.nextRenewal, "day")}</div>
                  <div className={`mt-1 text-[13px] ${urgent.missed ? "text-alert" : "text-muted"}`}>
                    {urgent.missed ? "Expected — not in your statement" : `${relDays(daysUntil(urgent.nextRenewal, today))} · estimated`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[22px]">{urgent.billType === "variable" ? "≈ " : ""}{money(urgent.amount, urgent.currency)}</div>
                  {urgent.billType === "variable" && <div className="text-[12px] text-muted">usually varies</div>}
                </div>
              </div>
              {missed.length > 1 && <p className="mt-3 text-[13px] text-alert">+ {missed.length - 1} more expected payment{missed.length > 2 ? "s" : ""} missing from the statement</p>}
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={`/subscriptions/${encodeURIComponent(urgent.id)}`} className="btn btn-primary">Review bill</Link>
                <Link href={`/pay/${encodeURIComponent(urgent.id)}`} className="btn btn-ghost">Prepare payment</Link>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-muted">Nothing due in the next 30 days.</p>
          )}
        </div>
      </section>

      {/* Before payday */}
      {inc.nextPayday && (
        <section className="flex flex-col gap-2 border-b rule bg-accent-wash/40 px-4 py-4 text-[14px] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span>
            <span className="font-medium">Next payday {date(inc.nextPayday)}</span> <span className="text-muted">({relDays(daysUntil(inc.nextPayday, today))})</span> ·{" "}
            {beforePayday.length} bill{beforePayday.length === 1 ? "" : "s"} due before then, about <span className="num font-medium">{money(dueBeforeTotal, home)}</span>
          </span>
          <Link href="/agent?q=Help%20me%20organise%20my%20bills%20before%20payday" className="text-[13px] link">Plan with the agent →</Link>
        </section>
      )}

      {/* Timeline */}
      <section className="border-b rule px-4 py-8 sm:px-8 lg:px-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-[26px]">Upcoming payments</h2>
          <span className="text-[12px] text-muted">{upcoming.length} in the next 30 days · {money(upcoming.reduce((x, s) => x + (homeOf(s) ?? 0), 0), home)}</span>
        </div>
        <ol className="border-t border-ink">
          {[...missed, ...upcoming.filter((u) => !missed.some((m) => m.id === u.id))].slice(0, 12).map((s) => {
            const d = daysUntil(s.nextRenewal, today);
            return (
              <li key={s.id}>
                <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="grid grid-cols-[64px_1fr_auto] items-center gap-x-4 border-b rule py-3 hover:bg-paper-2/50 sm:grid-cols-[92px_1fr_160px_auto]">
                  <span className={`num text-[13px] ${s.missed ? "text-alert" : d <= 3 ? "font-medium text-ink" : "text-muted"}`}>{s.missed ? "Missed?" : d === 0 ? "Today" : d === 1 ? "Tomorrow" : date(s.nextRenewal, "day")}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{s.displayName}</span>
                    <span className="text-[12px] text-muted">{s.category}{s.billType === "variable" ? " · varies" : ""}{s.status === "detected" ? " · unconfirmed" : ""}</span>
                  </span>
                  <span className="hidden text-[12px] text-muted sm:block">{KIND_LABEL[s.kind ?? "subscription"]}</span>
                  <span className="num text-right text-[15px]">{s.billType === "variable" ? "≈" : ""}{money(s.amount, s.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <Link href="/subscriptions" className="mt-3 inline-block text-[13px] text-muted link">All bills &amp; subscriptions →</Link>
      </section>

      <section className="grid xl:grid-cols-[1fr_340px]">
        <div className="px-4 py-8 sm:px-8 lg:px-12 xl:border-r xl:rule">
          {review > 0 && (
            <Link href="/subscriptions" className="mb-8 flex items-center justify-between gap-4 border border-amber/40 bg-amber-wash/60 px-4 py-3 text-[14px] hover:border-amber">
              <span><span className="num font-medium">{review}</span> detected item{review === 1 ? " is" : "s are"} waiting for you to confirm or dismiss.</span>
              <span className="whitespace-nowrap text-[13px] text-amber">Review →</span>
            </Link>
          )}

          <h2 className="display mb-1 text-[28px]">Where it goes</h2>
          <p className="mb-4 text-[13px] text-muted">Monthly equivalent, {home}. Variable bills use their typical amount.</p>
          <div className="border-t border-ink">
            {KINDS.map((k) => {
              const list = subs.filter((s) => (s.kind ?? "subscription") === k && s.status !== "dismissed" && !s.lapsed).sort((a, b) => (toHome(monthlyEquivalent(b), b.currency, home, rates) ?? 0) - (toHome(monthlyEquivalent(a), a.currency, home, rates) ?? 0));
              if (!list.length) return null;
              return (
                <div key={k} className="border-b rule py-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[15px] font-medium">{KIND_PLURAL[k]} <span className="text-[12px] font-normal text-muted">· {list.length}</span></h3>
                    <span className="num text-[15px]">{money(c.byKind[k].monthly, home)}<span className="text-[12px] text-muted">/mo</span></span>
                  </div>
                  <ul className="mt-2 grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
                    {list.map((s) => (
                      <li key={s.id} className="flex justify-between gap-3">
                        <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="truncate text-ink-2 hover:underline">{s.displayName}</Link>
                        <span className="num whitespace-nowrap text-muted">{money(toHome(monthlyEquivalent(s), s.currency, home, rates) ?? monthlyEquivalent(s), toHome(1, s.currency, home, rates) ? home : s.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-10 mb-3 flex items-end justify-between gap-3">
            <h2 className="display text-[28px]">Recent payments</h2>
            <Link href="/activity" className="text-[13px] text-muted link">History →</Link>
          </div>
          {state.payments.length ? (
            <ul className="border-t border-ink">
              {state.payments.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <Link href={`/activity/${p.id}`} className="flex items-center justify-between gap-4 border-b rule py-3 hover:bg-paper-2/50">
                    <span>
                      <span className="block text-[15px] font-medium">{p.merchant}</span>
                      <span className="num text-[12px] text-muted">{p.destinationAmount} {TOKENS[p.destinationToken].display} · {date(p.createdAt.slice(0, 10))}</span>
                    </span>
                    <TxStatus status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-ink pt-4 text-[14px] text-muted">No payments made through subscan yet. Bills whose provider accepts digital-dollar or naira stablecoin payments can be paid from a bill&rsquo;s page.</p>
          )}
        </div>

        <aside className="border-t rule px-4 py-8 sm:px-8 lg:px-12 xl:border-t-0 xl:px-8">
          <h2 className="kicker mb-3">Could save</h2>
          {savings.monthly > 0 ? (
            <>
              <div className="figure text-[48px]">{money(savings.monthly, home)}<span className="text-[0.35em] text-muted">/mo</span></div>
              <p className="mt-1 text-[12px] text-muted">If you act on the suggestions below. Subscriptions only — rent and loans aren&rsquo;t counted.</p>
            </>
          ) : (
            <p className="display text-[22px]">Nothing obvious to cut right now.</p>
          )}
          <ul className="mt-4 border-t rule">
            {savings.flags.slice(0, 5).map((f) => (
              <li key={f.subscriptionId} className="border-b rule py-2.5 text-[13px]">
                <div className="flex justify-between gap-3"><Link href={`/subscriptions/${encodeURIComponent(f.subscriptionId)}`} className="font-medium hover:underline">{f.name}</Link><span className="num text-muted">{money(f.monthlyHome ?? f.monthly, f.monthlyHome !== null ? home : f.currency)}</span></div>
                <div className="text-[12px] text-muted">{f.reason}</div>
              </li>
            ))}
            {!savings.flags.length && <li className="py-3 text-[13px] text-muted">No overlapping services, price rises or forgotten annual plans.</li>}
          </ul>

          {(changes.length > 0 || unusual.length > 0 || lapsed.length > 0) && (
            <div className="mt-8">
              <h2 className="kicker mb-3">Recent changes</h2>
              <ul className="space-y-3 text-[13px]">
                {changes.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="font-medium hover:underline">{s.displayName}</Link>{" "}
                    <span className={s.priceChange!.pct > 0 ? "text-alert" : "text-accent"}>{s.priceChange!.pct > 0 ? "+" : ""}{Math.round(s.priceChange!.pct * 100)}%</span>
                    <div className="num text-[12px] text-muted">{money(s.priceChange!.from, s.currency)} → {money(s.priceChange!.to, s.currency)} on {date(s.priceChange!.date)}</div>
                  </li>
                ))}
                {unusual.map((s) => (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="font-medium hover:underline">{s.displayName}</Link> <span className="text-alert">unusually high</span>
                    <div className="num text-[12px] text-muted">{money(s.unusual!.amount, s.currency)} vs usual {money(s.unusual!.typical, s.currency)}</div>
                  </li>
                ))}
                {lapsed.map((s) => (
                  <li key={s.id}>
                    <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="font-medium hover:underline">{s.displayName}</Link> <span className="text-muted">stopped</span>
                    <div className="text-[12px] text-muted">Last paid {date(s.lastCharge)} · left out of totals</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link href="/agent" className="mt-8 block border border-ink px-4 py-4 hover:bg-paper-2">
            <div className="kicker mb-1 text-accent">Your agent</div>
            <div className="display text-[20px]">“How much could I save by cancelling unused subscriptions?”</div>
            <div className="mt-2 text-[12px] text-muted">Ask about your bills, spending and payments →</div>
          </Link>
        </aside>
      </section>
    </div>
  );
}

/** Statement imported, but nothing repeats on a schedule. Explain — never invent bills. */
function NoRecurring() {
  const { state } = useStore();
  const txs = state.transactions;
  const dates = txs.map((t) => t.date).sort();
  const spanDays = dates.length ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000) : 0;
  const out = txs.filter((t) => (t.direction ?? "debit") === "debit").length;
  const dismissed = state.subscriptions.filter((s) => s.status === "dismissed").length;
  return (
    <div className="grid border-b rule lg:grid-cols-[1.2fr_1fr]">
      <div className="px-4 py-14 sm:px-8 lg:border-r lg:rule lg:px-12 lg:py-20">
        <div className="kicker mb-4">Statement analysed</div>
        <h1 className="display max-w-xl text-[40px] sm:text-[54px]">No recurring payments found yet.</h1>
        <p className="mt-4 max-w-md text-[16px] text-ink-2">
          We read {txs.length} transactions ({out} money out){dates.length ? ` from ${date(dates[0])} to ${date(dates[dates.length - 1])}` : ""} and didn&rsquo;t find payments that repeat on a regular schedule
          {dismissed ? `, apart from ${dismissed} you dismissed` : ""}. We won&rsquo;t guess — nothing is shown as a bill unless the statement supports it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/onboarding" className="btn btn-primary">Upload more months</Link>
          <Link href="/subscriptions" className="btn btn-ghost">Add a bill yourself</Link>
          <Link href="/agent?q=Show%20me%20where%20my%20money%20is%20going" className="btn btn-ghost">See where your money went</Link>
        </div>
      </div>
      <div className="bg-paper-2/60 px-4 py-14 sm:px-8 lg:px-10 lg:py-20">
        <div className="kicker mb-4">Why this can happen</div>
        <ul className="space-y-4 text-[14px] text-ink-2">
          <li className={spanDays < 60 ? "font-medium text-ink" : ""}>The statement covers {spanDays} days. A monthly bill needs at least two charges to be spotted — 3 to 12 months works best.</li>
          <li>Bills paid from another account or card won&rsquo;t appear in this statement.</li>
          <li>Prepaid purchases (airtime, electricity tokens) bought irregularly may not form a pattern.</li>
          <li>Some rows may have been left out at the review step. Check Settings → Imported statements.</li>
        </ul>
      </div>
    </div>
  );
}
