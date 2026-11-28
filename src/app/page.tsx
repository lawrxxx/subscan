"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Amount, Avatar, Icon, SectionHead } from "@/components/ui";
import { AccessStrip, ActivityRows } from "@/components/money";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { upcoming } from "@/lib/money/plan";
import { ruleSummary } from "@/lib/money/rules";
import { accessState, liveRate, readBalances } from "@/lib/money/runner";
import type { Balances } from "@/lib/money/rules";
import { describe } from "@/lib/money/schedule";

export default function Home() {
  const { state, ready, dismissLegacyNotice } = useStore();
  const [bal, setBal] = useState<Balances | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const access = accessState(state);
  const ap = state.autopilot;
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.all([readBalances(state), liveRate()]).then(([b, r]) => {
      if (!live) return;
      setBal(b);
      setRate(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // Refresh when activity changes (a transfer or conversion just finished).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ap?.sealedPolicy, state.activity.length, state.activity[0]?.status]);

  const next = useMemo(() => upcoming(state, today, 4), [state, today]);
  if (!ready) return null;

  const hour = new Date().getHours();
  const greeting = `good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}${state.settings.displayName ? `, ${state.settings.displayName}` : ""}`;
  const waiting = state.activity.filter((a) => a.status === "awaiting_approval");
  const activeRules = state.rules.filter((r) => r.status === "active");
  const recent = state.activity.filter((a) => a.status !== "awaiting_approval").slice(0, 5);
  const totalUsd = bal && rate ? bal.USDT + bal.cNGN / rate : null;

  return (
    <div className="px-4 pt-3 sm:px-6 lg:px-8 lg:pt-8">
      <header className="mb-4">
        <h1 className="title text-[26px] sm:text-[30px]">{greeting}</h1>
        <p className="mt-1 text-[13.5px] text-muted">your money, rules and transfers in one place.</p>
      </header>

      {state.legacyCleared && (
        <div className="callout callout-sage mb-3 items-start">
          <span className="min-w-0 text-[13px]"><span className="font-semibold">subscan has changed.</span> It now manages money in your payment wallet with rules and recurring transfers. Bank statements and bills from the earlier version were removed from this browser. Payments that went through on Celo are still in your activity.</span>
          <button className="btn btn-quiet btn-sm shrink-0" onClick={dismissLegacyNotice}>OK</button>
        </div>
      )}

      {!ap?.wallet ? (
        <NoWallet />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
          <div className="space-y-2.5">
            <section className="rounded-[16px] bg-accent px-5 py-5 text-[#f6f2e9]">
              <div className="flex items-center justify-between text-[13px] text-[#f6f2e9]/80"><span>my money</span><Link href="/payment-wallet" className="inline-flex items-center gap-1 hover:text-white">payment wallet <Icon name="chev" size={14} /></Link></div>
              <div className="figure mt-2 text-[34px] sm:text-[38px]">{loading ? "…" : totalUsd !== null ? `≈ $${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : bal ? "—" : "—"}</div>
              <div className="mt-1 text-[12.5px] text-[#f6f2e9]/75">{bal ? (totalUsd !== null ? "total available, in US dollars at Textile's live rate" : "live rate unavailable; see each currency below") : access === "none" ? "give subscan access to see your balances here" : "balances unavailable right now"}</div>
              {bal && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(["USDT", "cNGN"] as const).map((t) => (
                    <div key={t} className="rounded-[12px] bg-white/10 px-3 py-2.5">
                      <div className="text-[12px] text-[#f6f2e9]/75">{t === "USDT" ? "US dollars" : "Naira"}</div>
                      <Amount value={bal[t]} token={t} className="mt-0.5 block text-[16px] font-semibold" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <AccessStrip access={access} expiry={ap.expiry} />

            <div className="grid grid-cols-2 gap-2.5">
              <Link href="/rules/new" className="btn btn-ghost h-auto flex-col gap-1 rounded-[14px] py-3"><Icon name="rules" size={18} className="text-accent" />add a money rule</Link>
              <Link href="/transfers/new" className="btn btn-ghost h-auto flex-col gap-1 rounded-[14px] py-3"><Icon name="transfer" size={18} className="text-accent" />schedule a transfer</Link>
            </div>

            {waiting.length > 0 && (
              <Link href="/history?filter=awaiting_approval" className="callout callout-amber hover:brightness-[0.98]">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="tile bg-surface text-amber"><Icon name="alert" size={17} /></span>
                  <span className="min-w-0"><span className="block font-semibold">{waiting.length} waiting for your OK</span><span className="block truncate text-[12.5px] text-ink-2">{waiting[0].note ?? "Review before anything is sent."}</span></span>
                </span>
                <Icon name="chev" size={18} className="chev" />
              </Link>
            )}
          </div>

          <div className="space-y-5">
            <section>
              <SectionHead title="upcoming transfers" href="/transfers" link="all transfers" />
              <div className="panel">
                {!next.length ? (
                  <p className="px-4 py-4 text-[13px] text-muted">No transfers scheduled. <Link href="/transfers/new" className="link">Schedule one</Link>.</p>
                ) : (
                  <ul className="rows">
                    {next.map((u) => (
                      <li key={`${u.schedule.id}-${u.date}`}>
                        <Link href={`/transfers/${u.schedule.id}`} className="row">
                          <span className="flex min-w-0 items-center gap-3">
                            <Avatar name={u.recipient?.name ?? "?"} size={36} />
                            <span className="min-w-0"><span className="row-title">{u.recipient?.name ?? "Removed recipient"}</span><span className="row-sub">{date(u.date, "day")} · {u.schedule.status === "paused" ? "paused" : describe(u.schedule).toLowerCase()}</span></span>
                          </span>
                          <Amount value={u.schedule.amount} token={u.schedule.token} className="row-amount" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <SectionHead title="active money rules" href="/rules" link="all rules" />
              <div className="panel">
                {!activeRules.length ? (
                  <p className="px-4 py-4 text-[13px] text-muted">No active rules. <Link href="/rules/new" className="link">Add one</Link>.</p>
                ) : (
                  <ul className="rows">
                    {activeRules.slice(0, 4).map((r) => (
                      <li key={r.id}>
                        <Link href={`/rules/${r.id}`} className="row">
                          <span className="flex min-w-0 items-center gap-3"><span className="tile"><Icon name="rules" size={17} /></span><span className="min-w-0"><span className="row-title">{r.name}</span><span className="row-sub">{ruleSummary(r)}</span></span></span>
                          <Icon name="chev" size={16} className="chev" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <SectionHead title="recent activity" href="/history" link="all activity" />
              <div className="panel">{!recent.length ? <p className="px-4 py-4 text-[13px] text-muted">Nothing yet. Completed, pending and failed transfers and conversions will show here.</p> : <ActivityRows items={recent} />}</div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function NoWallet() {
  return (
    <div className="space-y-4 lg:max-w-[640px]">
      <section className="rounded-[16px] bg-accent px-5 py-6 text-[#f6f2e9]">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12"><Icon name="wallet" size={20} /></span>
        <div className="mt-3 text-[18px] font-semibold">Set up your payment wallet</div>
        <p className="mt-1 text-[13.5px] text-[#f6f2e9]/80">A wallet only you control, unlocked with Face ID or your fingerprint. subscan can then keep your balances where you want them and send scheduled transfers to people you&rsquo;ve saved, only within the limits you set.</p>
        <Link href="/payment-wallet" className="btn btn-lg mt-5 w-full bg-[#f6f2e9] text-accent hover:bg-white sm:w-auto">Get started</Link>
      </section>
      <ol className="grid gap-3 text-[13.5px] sm:grid-cols-2">
        {[
          ["wallet", "Create your payment wallet", "Face ID or fingerprint. No passwords."],
          ["shield", "Choose what subscan may do", "Monthly limits, a per-transfer cap and an end date."],
          ["rules", "Add money rules", "Keep a minimum, convert when low, keep a share in dollars."],
          ["transfer", "Schedule transfers", "To people you've saved and confirmed."],
        ].map(([icon, k, v]) => (
          <li key={k} className="flex items-center gap-3"><span className="tile"><Icon name={icon} size={17} /></span><span className="min-w-0"><span className="block font-medium">{k}</span><span className="block text-[12.5px] text-muted">{v}</span></span></li>
        ))}
      </ol>
    </div>
  );
}

