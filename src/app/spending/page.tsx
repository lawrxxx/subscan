"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyPanel, Icon, PageBar, UploadButton } from "@/components/ui";
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
  const [limit, setLimit] = useState(30);
  const [open, setOpen] = useState<Transaction | null>(null);

  const history = historyDays(state);
  const sum = useMemo(() => spendingSummary(state, days), [state, days]);
  const bills = useMemo(() => new Map<string, Subscription>(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => [s.merchant, s])), [state.subscriptions]);
  const sourceOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of state.imports ?? []) m.set(i.id, i.fileName);
    return (t: Transaction) => m.get(t.id.split("-")[0]) ?? (t.source === "manual" ? "Added by you" : "Statement");
  }, [state.imports]);

  useEffect(() => setLimit(30), [days, cat, q]);

  if (!ready) return null;
  if (!sum)
    return (
      <div>
        <PageBar title="Spending" sub="Where your money goes" />
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
  const top = sum.categories.slice(0, 6);

  return (
    <div>
      <PageBar title="Spending" sub={<>{date(sum.from)} – {date(sum.to)}</>}>
        <div className="seg mt-3" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.days} aria-pressed={days === p.days} onClick={() => { setDays(p.days); setCat(null); }} disabled={p.days > 30 && history < p.days * 0.5}>{p.label}</button>
          ))}
        </div>
      </PageBar>

      <div className="space-y-4 px-4 sm:px-6 lg:px-8">
        <section className="panel px-4 py-4">
          <div className="label">Spent in the last {periodLabel}</div>
          <div className="figure mt-1 text-[28px]">{money(sum.total, home)}</div>
          <p className="mt-1 text-[13px] text-muted">
            {change !== null ? (
              <><span className={change > 0 ? "text-alert" : "text-accent"}>{change >= 0 ? "Up" : "Down"} {Math.abs(Math.round(change * 100))}%</span> on the {periodLabel} before ({money(sum.previous!, home)})</>
            ) : (
              "Add more months to compare with earlier periods."
            )}
            {sum.moneyIn > 0 && <> · Money in {money(sum.moneyIn, home)}</>}
          </p>
          {sum.otherCurrencies.length > 0 && <p className="mt-1 text-[12px] text-faint">Payments in {sum.otherCurrencies.join(", ")} aren&rsquo;t included in this total.</p>}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Main categories</h2>{cat && <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => setCat(null)}>Show all</button>}</div>
            <ul className="px-4 py-2">
              {top.map((c) => (
                <li key={c.name}>
                  <button className={`w-full py-2 text-left ${cat && cat !== c.name ? "opacity-50" : ""}`} onClick={() => setCat(cat === c.name ? null : c.name)} aria-pressed={cat === c.name}>
                    <div className="flex justify-between gap-3 text-[13.5px]"><span>{c.name} <span className="text-muted">· {c.count}</span></span><span className="num">{money(c.amount, home)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-2"><div className={`h-full rounded-full ${c.bill ? "bg-accent" : "bg-[#b5ae9f]"}`} style={{ width: `${(c.amount / top[0].amount) * 100}%` }} /></div>
                  </button>
                </li>
              ))}
            </ul>
            {sum.categories.length > top.length && <p className="border-t rule px-4 py-2 text-[12px] text-muted">Plus {sum.categories.length - top.length} smaller categories</p>}
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Biggest payments</h2></div>
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {sum.largest.map((t) => (
                <li key={t.id}>
                  <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-paper-2/50" onClick={() => setOpen(t)}>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{bills.get(t.merchant)?.displayName ?? txLabel(t)}</span>
                      <span className="text-[12px] text-muted">{date(t.date, "day")} · {t.category}</span>
                    </span>
                    <span className="num shrink-0 text-[13.5px]">{money(t.amount, t.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{cat ? cat : "Your transactions"}</h2>
            <span className="text-[12.5px] text-muted">{list.length}</span>
          </div>
          <div className="border-b rule px-3 py-2.5">
            <label className="relative block">
              <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
              <input className="input pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
            </label>
          </div>
          {!list.length ? (
            <p className="px-4 py-6 text-center text-[13.5px] text-muted">Nothing matches.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {list.slice(0, limit).map((t) => {
                const credit = (t.direction ?? "debit") === "credit";
                return (
                  <li key={t.id}>
                    <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-paper-2/50" onClick={() => setOpen(t)}>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">{t.billName ?? txLabel(t)}</span>
                        <span className="block truncate text-[12px] text-muted">{date(t.date, "day")} · {t.category}</span>
                      </span>
                      <span className={`num shrink-0 text-[13.5px] ${credit ? "text-accent" : ""}`}>{credit ? "+" : "−"}{money(t.amount, t.currency)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > limit && <div className="border-t rule px-4 py-2.5 text-center"><button className="btn btn-ghost btn-sm" onClick={() => setLimit((l) => l + 50)}>Show more</button></div>}
        </section>
        <p className="text-[12px] text-muted">Looking for payments made from your wallet? They&rsquo;re in <Link href="/wallet" className="link">Settings → Wallet</Link>.</p>
      </div>

      {open && <TxDrawer t={open} bills={bills} source={sourceOf(open)} onClose={() => setOpen(null)} />}
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
      <aside className="anim-sheet flex h-full w-full max-w-md flex-col overflow-y-auto border-l rule bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
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
            <Link href={`/payments/${encodeURIComponent(bill.id)}`} className="mt-5 flex items-center justify-between rounded-[6px] border rule px-4 py-3 text-[13.5px] hover:bg-paper-2">
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
