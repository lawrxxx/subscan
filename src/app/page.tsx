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
import { Avatar, EmptyPanel, Icon, SectionHead, UploadButton } from "@/components/ui";
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

  const hour = new Date().getHours();
  const greeting = `good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}${state.settings.displayName ? `, ${state.settings.displayName}` : ""}`;
  const comingCount = upcoming.filter((u) => u.next).length;

  return (
    <div className="px-4 pt-3 sm:px-6 lg:px-8 lg:pt-8">
      <header className="mb-4">
        <h1 className="title text-[26px] sm:text-[30px]">{greeting}</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          here&rsquo;s what&rsquo;s happening with your money{spend ? `, up to ${date(spend.to)}` : ""}.
        </p>
      </header>

      <div className="space-y-2.5">
        {autoNotes.length > 0 && (
          <section className="callout callout-sage block" aria-live="polite">
            <div className="font-semibold">Autopilot</div>
            <ul className="mt-0.5 space-y-0.5 text-ink-2">{autoNotes.map((m, i) => <li key={i}>{m}</li>)}</ul>
            <Link href="/autopilot" className="mt-1 inline-block text-[12.5px] font-medium text-accent underline underline-offset-2">see Autopilot</Link>
          </section>
        )}
        {agentNotices.length > 0 && (
          <section className="callout callout-amber block" aria-label="subscan needs you">
            <div className="font-semibold">subscan needs you</div>
            <ul className="mt-1 space-y-1">
              {agentNotices.slice(0, 3).map((d) => (
                <li key={d.billId} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{d.name}</span> <span className="text-ink-2">· {d.reasons[0]}</span></span>
                  {d.action && <Link href={d.action.href} className="text-[12.5px] font-semibold text-amber underline underline-offset-2">{d.action.label}</Link>}
                </li>
              ))}
            </ul>
            {agentNotices.length > 3 && <Link href="/agent" className="mt-1 inline-block text-[12.5px] text-muted underline">{agentNotices.length - 3} more</Link>}
          </section>
        )}
        {toCheck.length > 0 && (
          <Link href="/review" className="callout callout-amber hover:brightness-[0.98]">
            <span className="flex min-w-0 items-center gap-3">
              <span className="tile bg-surface text-amber"><Icon name="alert" size={17} /></span>
              <span className="min-w-0">
                <span className="block font-semibold">{toCheck.length} payment{toCheck.length === 1 ? "" : "s"} to check</span>
                <span className="block text-[12.5px] text-ink-2">Confirm the real ones so your totals are right.</span>
              </span>
            </span>
            <Icon name="chev" size={18} className="chev" />
          </Link>
        )}
      </div>

      <div className={`grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 ${autoNotes.length || agentNotices.length || toCheck.length ? "mt-4" : ""}`}>
        <div className="space-y-2.5">
          <Link href="/payments" className="block rounded-[16px] bg-accent px-5 py-5 text-[#f6f2e9] hover:bg-accent-2">
            <div className="flex items-center justify-between text-[13px] text-[#f6f2e9]/80"><span>monthly payments</span><Icon name="chev" size={16} /></div>
            <div className="figure mt-2 text-[34px] sm:text-[38px]">{confirmed.length ? money(monthly.monthlyHome ?? 0, home) : "—"}</div>
            <div className="mt-1.5 text-[13px] text-[#f6f2e9]/80">
              {confirmed.length ? `across ${confirmed.length} regular payment${confirmed.length === 1 ? "" : "s"}` : toCheck.length ? "none confirmed yet" : "none found yet"}
              {toCheck.length > 0 && confirmed.length > 0 && pendingMonthly.monthlyHome ? ` · ${money(pendingMonthly.monthlyHome, home)} more to check` : ""}
            </div>
          </Link>

          <div className="grid grid-cols-2 gap-2.5">
            <Link href="/payments" className="panel block px-4 py-4 hover:border-line-strong">
              <Icon name="calendar" size={18} className="text-accent" />
              <div className="mt-3 text-[12.5px] text-muted">coming up</div>
              <div className={`figure mt-0.5 text-[24px] ${upcoming.some((u) => !u.next) ? "text-alert" : ""}`}>{upcoming.length}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">{upcoming.length ? `${money(dueTotal, home)} · 30 days` : "nothing expected"}</div>
            </Link>
            <Link href="/spending" className="panel block px-4 py-4 hover:border-line-strong">
              <Icon name="spending" size={18} className="text-accent" />
              <div className="mt-3 text-[12.5px] text-muted">spending</div>
              <div className="figure mt-0.5 truncate text-[24px]">{spend ? money(spend.total, home) : "—"}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">{change !== null ? <><span className={change > 0 ? "text-alert" : "text-positive"}>{change >= 0 ? "up" : "down"} {Math.abs(Math.round(change * 100))}%</span> · 30 days</> : days < 60 ? "last 30 days" : "last 30 days"}</div>
            </Link>
          </div>

          {savings.monthly > 0 && (
            <Link href="/agent?q=save" className="callout callout-sage hover:brightness-[0.98]">
              <span className="flex min-w-0 items-center gap-3">
                <span className="tile bg-surface"><Icon name="leaf" size={17} /></span>
                <span className="min-w-0">
                  <span className="block font-semibold">possible savings · <span className="num">{money(savings.monthly, home)}/mo</span></span>
                  <span className="block truncate text-[12.5px] text-ink-2">{savings.flags.length} idea{savings.flags.length === 1 ? "" : "s"} to look at. Nothing is cancelled for you.</span>
                </span>
              </span>
              <Icon name="chev" size={18} className="chev" />
            </Link>
          )}

          {!live.length && <NoRecurring spanDays={days} />}
        </div>

        <div className="space-y-5">
          {live.length > 0 && (
            <section>
              <SectionHead title={comingCount || !upcoming.length ? "next payments" : "needs a look"} href="/payments" link="all payments" />
              <div className="panel">
                {!upcoming.length ? (
                  <p className="px-4 py-4 text-[13px] text-muted">Nothing we can predict for the next 30 days. We only show a date when a payment has come in regularly at least three times.</p>
                ) : (
                  <ul className="rows">
                    {upcoming.slice(0, 5).map(({ s, next }) => {
                      const d = next ? Math.round((Date.parse(next) - Date.parse(today)) / DAY) : null;
                      return (
                        <li key={s.id}>
                          <Link href={`/payments/${encodeURIComponent(s.id)}`} className="row">
                            <span className="flex min-w-0 items-center gap-3">
                              <Avatar name={name(s)} size={36} />
                              <span className="min-w-0">
                                <span className="row-title">{name(s)}</span>
                                <span className={`row-sub ${next ? "" : "!text-alert"}`}>{next ? (d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due ${date(next, "day")} · in ${d} days`) : "expected but not in your statement"}{s.status === "detected" ? " · not checked" : ""}</span>
                              </span>
                            </span>
                            <span className="row-amount">{s.billType === "variable" ? "≈ " : ""}{money(s.amount, s.currency)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}

          {spend && spend.categories.length > 0 && (
            <section>
              <SectionHead title="where your money went" href="/spending" link="spending" />
              <div className="panel px-4 py-3.5">
                <div className="flex h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                  {spend.categories.slice(0, 5).map((c, i) => <span key={c.name} style={{ width: `${(c.amount / spend.total) * 100}%`, background: CAT_TONES[i] }} />)}
                </div>
                <ul className="mt-3 space-y-2">
                  {spend.categories.slice(0, 4).map((c, i) => (
                    <li key={c.name} className="flex items-center justify-between gap-3 text-[13.5px]">
                      <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CAT_TONES[i] }} /><span className="truncate">{c.name}</span></span>
                      <span className="num shrink-0 text-ink-2">{money(c.amount, home)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {savings.flags.length > 0 && (
            <section className="hidden lg:block">
              <SectionHead title="savings ideas" href="/agent?q=save" link="details" />
              <div className="panel">
                <ul className="rows">
                  {savings.flags.slice(0, 3).map((f) => (
                    <li key={f.subscriptionId}>
                      <Link href={`/payments/${encodeURIComponent(f.subscriptionId)}`} className="row">
                        <span className="min-w-0">
                          <span className="row-title">{f.name}</span>
                          <span className="row-sub">{readableDates(f.reason[0].toUpperCase() + f.reason.slice(1))}</span>
                        </span>
                        <span className="row-amount text-positive">{money(f.monthlyHome ?? f.monthly, f.monthlyHome !== null ? home : f.currency)}/mo</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const CAT_TONES = ["#173f32", "#5f8a70", "#d8b98c", "#a9c1a6", "#c9c2b2"];

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
    <div className="px-4 pt-6 pb-8 sm:px-6 lg:px-8 lg:pt-14">
      <div className="mx-auto max-w-[560px] lg:mx-0">
        <h1 className="title text-[28px] sm:text-[32px]">your money, handled.</h1>
        <p className="mt-2 text-[15px] text-ink-2">Add a bank statement. subscan finds your regular payments, shows where your money goes and what&rsquo;s coming up.</p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`mt-6 rounded-[16px] px-5 py-6 transition-colors ${drag ? "bg-accent-2 text-[#f6f2e9]" : "bg-accent text-[#f6f2e9]"}`}
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12"><Icon name="upload" size={20} /></span>
          <div className="mt-3 text-[17px] font-semibold">{drag ? "Drop it here" : "Upload your statement"}</div>
          <div className="mt-0.5 text-[13px] text-[#f6f2e9]/75">The PDF or CSV you download from your bank. Three months or more works best.</div>
          <button className="btn btn-lg mt-5 w-full bg-[#f6f2e9] text-accent hover:bg-white sm:w-auto" onClick={() => input.current?.click()}>Choose a file</button>
          <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Statement file" onChange={(e) => pick(e.target.files?.[0])} />
        </div>

        <ol className="mt-7 grid grid-cols-1 gap-x-4 gap-y-3 text-[13.5px] sm:grid-cols-2">
          {[
            ["upload", "Upload a statement", "PDF or CSV from your bank"],
            ["search", "subscan organises it", "Sorts every transaction for you"],
            ["check", "Check a few items", "Only the ones that are unclear"],
            ["bolt", "Let subscan handle it", "Pay approved bills within your limits"],
          ].map(([icon, k, v]) => (
            <li key={k} className="flex items-center gap-3">
              <span className="tile"><Icon name={icon} size={17} /></span>
              <span className="min-w-0"><span className="block font-medium">{k}</span><span className="block text-[12.5px] text-muted">{v}</span></span>
            </li>
          ))}
        </ol>

        <p className="mt-7 flex items-start gap-2 text-[12.5px] text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
          Your statement stays on this device. You check everything before it&rsquo;s saved. We never ask for your bank login.
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
