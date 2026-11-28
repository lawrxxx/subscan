"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Avatar, EmptyPanel, Icon, PageBar, UploadButton } from "@/components/ui";
import { txCategory } from "@/lib/attention";
import { useStore } from "@/lib/db/store";
import { date, money, txLabel } from "@/lib/format";
import { historyDays, spendingSummary } from "@/lib/spending";
import type { Subscription, Transaction } from "@/lib/types";

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 91, label: "3 months" },
  { days: 365, label: "12 months" },
];

export default function Spending() {
  const { state, ready } = useStore();
  const home = state.settings.homeCurrency;
  const [days, setDays] = useState(30);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(15);
  const [open, setOpen] = useState<Transaction | null>(null);

  const history = historyDays(state);
  const sum = useMemo(() => spendingSummary(state, days), [state, days]);
  const bills = useMemo(() => new Map<string, Subscription>(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => [s.merchant, s])), [state.subscriptions]);
  const sourceOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of state.imports ?? []) m.set(i.id, i.fileName);
    return (t: Transaction) => m.get(t.id.split("-")[0]) ?? (t.source === "manual" ? "Added by you" : "Statement");
  }, [state.imports]);

  useEffect(() => setLimit(15), [days, cat, q]);

  if (!ready) return null;
  if (!sum)
    return (
      <div>
        <PageBar title="spending" sub="where your money goes" />
        <div className="px-4 sm:px-6 lg:px-8">
          <section className="panel">
            <EmptyPanel icon="spending" title="No transactions yet" action={<UploadButton label="Add a statement" />}>Add a bank statement to see where your money goes.</EmptyPanel>
          </section>
        </div>
      </div>
    );

  const change = sum.previous ? (sum.total - sum.previous) / sum.previous : null;
  const periodLabel = PERIODS.find((p) => p.days === days)!.label;
  const list = sum.transactions.filter((t) => (!cat || ((t.direction ?? "debit") === "debit" && t.category === cat)) && (!q || `${t.description} ${t.billName ?? ""} ${t.category}`.toLowerCase().includes(q.toLowerCase())));

  const slices = donutSlices(sum.categories, sum.total);

  return (
    <div>
      <PageBar title="spending" sub="where your money goes">
        <div className="seg mt-4" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.days} aria-pressed={days === p.days} onClick={() => { setDays(p.days); setCat(null); }} disabled={p.days > 30 && history < p.days * 0.5}>{p.label}</button>
          ))}
        </div>
      </PageBar>

      <div className="space-y-5 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-2.5 lg:max-w-[640px]">
          <section className="rounded-[14px] bg-alert-wash px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><Icon name="out" size={14} className="text-alert" />money out</div>
            <div className="figure mt-1.5 truncate text-[22px] sm:text-[26px]">{money(sum.total, home)}</div>
            <div className="mt-0.5 truncate text-[12px] text-ink-2">{change !== null ? <>{change >= 0 ? "up" : "down"} {Math.abs(Math.round(change * 100))}% vs before</> : `last ${periodLabel}`}</div>
          </section>
          <section className="rounded-[14px] bg-sage px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><Icon name="in" size={14} className="text-positive" />money in</div>
            <div className="figure mt-1.5 truncate text-[22px] sm:text-[26px]">{money(sum.moneyIn, home)}</div>
            <div className="mt-0.5 truncate text-[12px] text-ink-2">{date(sum.from, "day")} – {date(sum.to, "day")}</div>
          </section>
        </div>
        {sum.otherCurrencies.length > 0 && <p className="-mt-3 text-[12px] text-faint">Payments in {sum.otherCurrencies.join(", ")} aren&rsquo;t included in these totals.</p>}

        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="section-title">by category</h2>
              {cat && <button className="section-link" onClick={() => setCat(null)}>show all</button>}
            </div>
            <div className="panel flex flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:items-center">
              <Donut slices={slices} total={money(sum.total, home)} />
              <ul className="w-full min-w-0 flex-1 space-y-0.5">
                {slices.map((c) => (
                  <li key={c.name}>
                    <button
                      className={`flex w-full items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] hover:bg-paper-2 ${cat && cat !== c.name ? "opacity-45" : ""}`}
                      onClick={() => c.name !== "Others" && setCat(cat === c.name ? null : c.name)}
                      aria-pressed={cat === c.name}
                      disabled={c.name === "Others"}
                    >
                      <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} /><span className="truncate">{c.name}</span></span>
                      <span className="flex shrink-0 items-baseline gap-2"><span className="num text-ink-2">{money(c.amount, home)}</span><span className="num w-9 text-right text-[12px] text-muted">{Math.round(c.share * 100)}%</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="hidden lg:block">
            <div className="mb-2 px-1"><h2 className="section-title">biggest payments</h2></div>
            <div className="panel">
              <ul className="rows">
                {sum.largest.map((t) => (
                  <li key={t.id}>
                    <button className="row" onClick={() => setOpen(t)}>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={bills.get(t.merchant)?.displayName ?? txLabel(t)} size={34} />
                        <span className="min-w-0">
                          <span className="row-title">{bills.get(t.merchant)?.displayName ?? txLabel(t)}</span>
                          <span className="row-sub">{date(t.date, "day")} · {t.category}</span>
                        </span>
                      </span>
                      <span className="row-amount">{money(t.amount, t.currency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="section-title">{cat ? cat.toLowerCase() : "recent transactions"}</h2>
            <span className="text-[12.5px] text-muted num">{list.length}</span>
          </div>
          <label className="relative mb-2.5 block">
            <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <input className="input rounded-full pl-9" placeholder="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
          </label>
          <div className="panel">
            {!list.length ? (
              <p className="px-4 py-6 text-center text-[13.5px] text-muted">Nothing matches.</p>
            ) : (
              <ul className="rows">
                {list.slice(0, limit).map((t) => {
                  const credit = (t.direction ?? "debit") === "credit";
                  return (
                    <li key={t.id}>
                      <button className="row" onClick={() => setOpen(t)}>
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={`tile h-9 w-9 ${credit ? "bg-sage text-positive" : "bg-paper-2 text-ink-2"}`} aria-label={credit ? "Money in" : "Money out"}><Icon name={credit ? "in" : "out"} size={16} /></span>
                          <span className="min-w-0">
                            <span className="row-title">{t.billName ?? txLabel(t)}</span>
                            <span className="row-sub">{date(t.date, "day")} · {t.category}</span>
                          </span>
                        </span>
                        <span className={`row-amount ${credit ? "text-positive" : ""}`}>{credit ? "+" : "−"}{money(t.amount, t.currency)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length > limit && <div className="border-t rule px-4 py-2.5 text-center"><button className="btn btn-ghost btn-sm" onClick={() => setLimit((l) => l + 50)}>Show more</button></div>}
          </div>
        </section>
        <p className="text-[12px] text-muted">Looking for payments made from your wallet? They&rsquo;re in <Link href="/wallet" className="link">Settings → Wallet</Link>.</p>
      </div>

      {open && <TxDrawer t={open} bills={bills} source={sourceOf(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

const SLICE_TONES = ["#173f32", "#5f8a70", "#d8b98c", "#a9c1a6", "#b98a5a", "#cfc8b8"];

function donutSlices(categories: { name: string; amount: number }[], total: number) {
  const top = categories.slice(0, 5);
  const rest = categories.slice(5).reduce((x, c) => x + c.amount, 0);
  const all = rest > 0 ? [...top, { name: "Others", amount: rest }] : top;
  return all.map((c, i) => ({ name: c.name, amount: c.amount, share: total ? c.amount / total : 0, color: SLICE_TONES[c.name === "Others" ? 5 : i] }));
}

/** Restrained donut: one ring, thin gaps, the total in the middle. */
function Donut({ slices, total }: { slices: { name: string; share: number; color: string }[]; total: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="relative h-[148px] w-[148px] shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--color-paper-2)" strokeWidth="16" />
        {slices.map((s) => {
          const len = Math.max(0, s.share * c - gap);
          const el = <circle key={s.name} cx="66" cy="66" r={r} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += s.share * c;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="figure px-3 text-[16px] leading-tight">{total}</span>
        <span className="text-[11.5px] text-muted">spent</span>
      </div>
    </div>
  );
}

function TxDrawer({ t, bills, source, onClose }: { t: Transaction; bills: Map<string, Subscription>; source: string; onClose(): void }) {
  const { state } = useStore();
  const { category, bill } = txCategory(t, bills);
  const credit = (t.direction ?? "debit") === "credit";
  const sameMerchant = state.transactions.filter((x) => x.merchant === t.merchant && x.id !== t.id).length;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="anim-fade fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose} role="dialog" aria-modal aria-label="Transaction details">
      <aside className="anim-sheet flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-xl sm:rounded-l-[16px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b rule px-5 py-3">
          <span className="label">Transaction details</span>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="px-5 py-6">
          <div className="truncate text-[17px] font-semibold">{bill?.displayName ?? txLabel(t)}</div>
          <div className="text-[13px] text-muted">{date(t.date, "long")}</div>
          <div className={`figure mt-4 text-[30px] ${credit ? "text-accent" : ""}`}>{credit ? "+" : "−"}{money(t.amount, t.currency)}</div>
          <dl className="mt-6 divide-y divide-[var(--color-rule)] border-y rule text-[13.5px]">
            {[
              ["On your statement", t.description],
              ["Type", credit ? "Money in" : "Money out"],
              ["Category", category],
              ...(t.currency !== state.settings.homeCurrency ? [["Currency", t.currency]] : []),
              ["From", source],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="shrink-0 text-muted">{k}</dt><dd className="text-right break-words">{v}</dd></div>
            ))}
          </dl>
          {bill ? (
            <Link href={`/payments/${encodeURIComponent(bill.id)}`} className="mt-5 flex items-center justify-between rounded-[12px] border rule px-4 py-3 text-[13.5px] hover:bg-paper-2">
              <span>Part of your regular payment <strong className="font-semibold">{bill.displayName}</strong></span>
              <Icon name="arrow" size={15} />
            </Link>
          ) : (
            !credit && sameMerchant > 0 && <p className="mt-5 text-[13px] text-muted">{sameMerchant} other transaction{sameMerchant === 1 ? "" : "s"} to the same place, but not regular enough to count as a regular payment.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
