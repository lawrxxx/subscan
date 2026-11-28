"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { commitments, savingsPotential, toHome } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { date, money, readableDates } from "@/lib/format";
import { setPendingUpload } from "@/lib/import/pending";
import { displayLabel, predictedNext, rawDescription } from "@/lib/review";
import { historyDays, spendingSummary } from "@/lib/spending";
import type { Subscription } from "@/lib/types";
import { EmptyPanel, Icon, PageBar, Stat, UploadButton } from "@/components/ui";
import { useAutopilotRunner } from "@/lib/autopilot/runner";
import { decide, notices } from "@/lib/agent/rules";

const DAY = 86_400_000;

export default function Home() {
  const store = useStore();
  const { state, ready } = store;
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  useAutopilotRunner(store, (m) => setAutoNotes((n) => [...n, m]));
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const today = new Date().toISOString().slice(0, 10);
  const subs = state.subscriptions;

  const live = useMemo(() => subs.filter((s) => s.status !== "dismissed"), [subs]);
  const confirmed = useMemo(() => live.filter((s) => s.status === "confirmed" || s.manual), [live]);
  const toCheck = live.filter((s) => s.status === "detected");
  const monthly = useMemo(() => commitments(confirmed, home, rates), [confirmed, home, rates]);
  const pendingMonthly = useMemo(() => commitments(toCheck, home, rates), [toCheck, home, rates]);
  const savings = useMemo(() => savingsPotential(subs, home, rates, today), [subs, home, rates, today]);
  const spend = useMemo(() => spendingSummary(state, 30), [state]);

  // Only payments whose next date the history supports, plus anything that looks missed.
  const upcoming = useMemo(() => {
    const until = new Date(Date.parse(today) + 30 * DAY).toISOString().slice(0, 10);
    const missed = live.filter((s) => s.missed && !s.lapsed);
    const next = live
      .map((s) => ({ s, next: predictedNext(s) }))
      .filter((x): x is { s: Subscription; next: string } => !!x.next && x.next >= today && x.next <= until && !x.s.missed)
      .sort((a, b) => a.next.localeCompare(b.next));
    return [...missed.map((s) => ({ s, next: null as string | null })), ...next];
  }, [live, today]);

  if (!ready) return null;
  if (!state.transactions.length && !subs.length) return <FirstRun />;
  // Only nag about bills the user chose to automate (or set up for wallet payment).
  const agentNotices = notices(decide(state)).filter((d) => state.subscriptions.find((x) => x.id === d.billId)?.autopay);

  const days = historyDays(state);
  const dueTotal = upcoming.reduce((x, u) => x + (toHome(u.s.amount, u.s.currency, home, rates) ?? 0), 0);
  const name = (s: Subscription) => displayLabel(s, rawDescription(s, state.transactions)).name;
  const change = spend && spend.previous ? (spend.total - spend.previous) / spend.previous : null;

  return (
    <div>
      <PageBar
        title="Home"
        sub={<>{state.imports?.length ?? 0} statement{(state.imports?.length ?? 0) === 1 ? "" : "s"}{spend ? ` · up to ${date(spend.to)}` : ""}</>}
        actions={<UploadButton label="Add a statement" className="btn btn-ghost hidden sm:inline-flex lg:hidden" />}
      />

      <div className="space-y-4 px-4 sm:px-6 lg:px-8">
        {autoNotes.length > 0 && (
          <section className="rounded-[6px] border rule bg-surface px-4 py-3 text-[13.5px]" aria-live="polite">
            <div className="font-semibold">Autopilot</div>
            <ul className="mt-1 space-y-0.5 text-ink-2">{autoNotes.map((m, i) => <li key={i}>{m}</li>)}</ul>
            <Link href="/autopilot" className="mt-1 inline-block text-[12.5px] text-muted underline">See Autopilot</Link>
          </section>
        )}
        {agentNotices.length > 0 && (
          <section className="rounded-[6px] border border-amber/30 bg-amber-wash px-4 py-3 text-[13.5px]" aria-label="The agent needs you">
            <div className="font-semibold">The agent needs you</div>
            <ul className="mt-1 space-y-1">
              {agentNotices.slice(0, 3).map((d) => (
                <li key={d.billId} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{d.name}</span> <span className="text-ink-2">· {d.reasons[0]}</span></span>
                  {d.action && <Link href={d.action.href} className="text-[12.5px] font-medium text-amber underline">{d.action.label}</Link>}
                </li>
              ))}
            </ul>
            {agentNotices.length > 3 && <Link href="/agent" className="mt-1 inline-block text-[12.5px] text-muted underline">{agentNotices.length - 3} more</Link>}
          </section>
        )}
        {toCheck.length > 0 && (
          <Link href="/review" className="flex items-center justify-between gap-3 rounded-[6px] border border-amber/30 bg-amber-wash px-4 py-3 text-[14px] hover:border-amber/60">
            <span><span className="font-semibold">We found {toCheck.length} payment{toCheck.length === 1 ? "" : "s"} to check.</span> <span className="text-ink-2">Confirm the real ones so your totals are right.</span></span>
            <span className="shrink-0 font-medium text-amber">Check <span aria-hidden>→</span></span>
          </Link>
        )}

        <section className="panel grid grid-cols-2 lg:grid-cols-4 [&>*]:border-rule max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-r">
          <Stat
            label="Monthly payments"
            value={confirmed.length ? money(monthly.monthlyHome ?? 0, home) : "—"}
            sub={confirmed.length ? `${confirmed.length} confirmed` : toCheck.length ? "None confirmed yet" : "None found"}
          />
          <Stat label="Coming up · 30 days" value={upcoming.length ? money(dueTotal, home) : "—"} sub={upcoming.length ? `${upcoming.length} payment${upcoming.length === 1 ? "" : "s"}` : "Nothing expected"} tone={upcoming.some((u) => !u.next) ? "alert" : undefined} />
          <Stat
            label="Spent · last 30 days"
            value={spend ? money(spend.total, home) : "—"}
            sub={change !== null ? `${change >= 0 ? "Up" : "Down"} ${Math.abs(Math.round(change * 100))}% on the 30 days before` : days < 60 ? "Add more months to compare" : undefined}
          />
          <Stat label="Possible savings" value={savings.monthly ? `${money(savings.monthly, home)}/mo` : "—"} sub={savings.flags.length ? `${savings.flags.length} idea${savings.flags.length === 1 ? "" : "s"}` : "Nothing obvious"} tone={savings.monthly ? "accent" : undefined} />
        </section>
        {toCheck.length > 0 && confirmed.length > 0 && pendingMonthly.monthlyHome ? (
          <p className="-mt-2 text-[12.5px] text-muted">Monthly payments only count what you&rsquo;ve confirmed. Another {money(pendingMonthly.monthlyHome, home)} a month is waiting to be checked.</p>
        ) : null}

        {!live.length && <NoRecurring spanDays={days} />}

        <div className="grid gap-4 lg:grid-cols-2">
          {live.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Coming up</h2>
                <Link href="/payments" className="text-[12.5px] text-muted hover:text-ink">All payments →</Link>
              </div>
              {!upcoming.length ? (
                <p className="px-4 py-4 text-[13px] text-muted">Nothing we can predict for the next 30 days. We only show a date when a payment has come in regularly at least three times.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-rule-soft)]">
                  {upcoming.slice(0, 6).map(({ s, next }) => {
                    const d = next ? Math.round((Date.parse(next) - Date.parse(today)) / DAY) : null;
                    return (
                      <li key={s.id}>
                        <Link href={`/payments/${encodeURIComponent(s.id)}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-paper-2/50">
                          <span className="min-w-0">
                            <span className="block truncate text-[14px] font-medium">{name(s)}</span>
                            <span className={`text-[12.5px] ${next ? "text-muted" : "text-alert"}`}>{next ? (d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${date(next, "day")} · in ${d} days`) : "Expected but not in your statement"}{s.status === "detected" ? " · not checked yet" : ""}</span>
                          </span>
                          <span className="num shrink-0 text-[14px]">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {spend && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Where your money went</h2>
                <Link href="/spending" className="text-[12.5px] text-muted hover:text-ink">Spending →</Link>
              </div>
              <div className="px-4 py-3">
                <div className="flex items-baseline justify-between text-[13px] text-muted"><span>{date(spend.from, "day")} – {date(spend.to)}</span><span className="num text-ink">{money(spend.total, home)}</span></div>
                <ul className="mt-2 space-y-2.5">
                  {spend.categories.slice(0, 4).map((c) => (
                    <li key={c.name}>
                      <div className="flex justify-between gap-3 text-[13.5px]"><span>{c.name}</span><span className="num">{money(c.amount, home)}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-2"><div className={`h-full rounded-full ${c.bill ? "bg-accent" : "bg-[#b5ae9f]"}`} style={{ width: `${(c.amount / spend.categories[0].amount) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {savings.flags.length > 0 && (
            <section className="panel lg:col-span-2">
              <div className="panel-head">
                <h2 className="panel-title">Possible savings</h2>
                <Link href="/agent?q=save" className="text-[12.5px] text-muted hover:text-ink">Details →</Link>
              </div>
              <ul className="divide-y divide-[var(--color-rule-soft)]">
                {savings.flags.slice(0, 3).map((f) => (
                  <li key={f.subscriptionId}>
                    <Link href={`/payments/${encodeURIComponent(f.subscriptionId)}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-paper-2/50">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium">{f.name}</span>
                        <span className="text-[12.5px] text-muted">{readableDates(f.reason[0].toUpperCase() + f.reason.slice(1))}</span>
                      </span>
                      <span className="num shrink-0 text-[13.5px] text-accent">{money(f.monthlyHome ?? f.monthly, f.monthlyHome !== null ? home : f.currency)}/mo</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="border-t rule px-4 py-2 text-[12px] text-muted">Ideas only. Nothing is cancelled for you.</p>
            </section>
          )}
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
        <p className="mt-2 text-[15px] text-ink-2">Add a bank statement to see what you spend, which payments are coming up and where you could save.</p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`mt-6 flex flex-col gap-3 rounded-[6px] border px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${drag ? "border-accent bg-accent-wash" : "border-dashed border-line-strong bg-surface"}`}
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{drag ? "Drop it here" : "Add your bank statement"}</div>
            <div className="text-[12.5px] text-muted">The PDF or CSV file you download from your bank</div>
          </div>
          <button className="btn btn-primary w-full shrink-0 sm:w-auto" onClick={() => input.current?.click()}>Choose file</button>
          <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Statement file" onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        <dl className="mt-8 divide-y divide-[var(--color-rule)] border-y rule text-[13.5px]">
          {[
            ["What you spend", "Your spending sorted into simple groups"],
            ["Regular payments", "Subscriptions, bills, rent, loans and insurance"],
            ["What's coming up", "Payments due soon, when we can tell"],
            ["Ways to save", "Things you might be paying for twice, or that got more expensive"],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2.5 sm:grid-cols-[180px_1fr]">
              <dt className="font-medium">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 flex items-start gap-2 text-[12.5px] text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          Your statement stays on this device. You check everything before it’s saved. We never ask for your bank login.
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
        title="No regular payments found yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <UploadButton label="Add more months" />
            <Link href="/payments?add=1" className="btn btn-ghost">Add a payment yourself</Link>
          </div>
        }
      >
        We looked at {state.transactions.length} transactions over {spanDays} days and didn&rsquo;t see anything that repeats{dismissed ? ` (apart from ${dismissed} you said aren’t regular)` : ""}. A payment has to show up at least twice, so three months or more works best.
      </EmptyPanel>
    </section>
  );
}
