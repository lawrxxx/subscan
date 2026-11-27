"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HashLink } from "@/components/bits";
import { Avatar, EmptyPanel, Icon, PageBar, PayStatus, UploadButton } from "@/components/ui";
import { txCategory } from "@/lib/attention";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import { date, money, payeeName } from "@/lib/format";
import type { PaymentStatus, Subscription, Transaction } from "@/lib/types";

type Tab = "transactions" | "payments";
type Dir = "all" | "debit" | "credit";

export default function Activity() {
  const { state, ready, removePayment } = useStore();
  const [tab, setTab] = useState<Tab>("transactions");
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<Dir>("all");
  const [category, setCategory] = useState("all");
  const [month, setMonth] = useState("all");
  const [sort, setSort] = useState<"new" | "old" | "high" | "low">("new");
  const [payStatus, setPayStatus] = useState<"all" | PaymentStatus>("all");
  const [open, setOpen] = useState<Transaction | null>(null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "payments") setTab("payments");
  }, []);

  const bills = useMemo(() => new Map<string, Subscription>(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => [s.merchant, s])), [state.subscriptions]);
  const rows = useMemo(
    () => [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).map((t) => ({ t, ...txCategory(t, bills) })),
    [state.transactions, bills],
  );
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);
  const months = useMemo(() => [...new Set(rows.map((r) => r.t.date.slice(0, 7)))], [rows]);
  const sourceOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of state.imports ?? []) m.set(i.id, i.fileName);
    return (t: Transaction) => m.get(t.id.split("-")[0]) ?? (t.source === "manual" ? "Added by you" : t.source.toUpperCase());
  }, [state.imports]);
  const filtered = rows.filter(
    (r) =>
      (dir === "all" || (r.t.direction ?? "debit") === dir) &&
      (category === "all" || r.category === category) &&
      (month === "all" || r.t.date.startsWith(month)) &&
      (!q || `${r.t.description} ${r.t.merchant} ${r.category}`.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => (sort === "old" ? a.t.date.localeCompare(b.t.date) : sort === "high" ? b.t.amount - a.t.amount : sort === "low" ? a.t.amount - b.t.amount : 0));
  const totals = filtered.reduce(
    (a, r) => {
      const k = (r.t.direction ?? "debit") === "credit" ? "in" : "out";
      a[k][r.t.currency] = (a[k][r.t.currency] ?? 0) + r.t.amount;
      return a;
    },
    { in: {} as Record<string, number>, out: {} as Record<string, number> },
  );
  const payments = state.payments.filter((p) => payStatus === "all" || p.status === payStatus);

  if (!ready) return null;
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join(" + ") || "—";

  return (
    <div>
      <PageBar
        title="Activity"
        sub={state.transactions.length ? `${state.transactions.length} imported transactions · ${state.payments.length} payment${state.payments.length === 1 ? "" : "s"} through subscan` : "Imported transactions and payments made through subscan"}
        actions={<UploadButton className="btn btn-ghost" />}
      >
        <div className="tabs mt-5" role="tablist">
          <button role="tab" aria-selected={tab === "transactions"} onClick={() => setTab("transactions")}>Statement transactions <span className="count">{state.transactions.length}</span></button>
          <button role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>subscan payments <span className="count">{state.payments.length}</span></button>
        </div>
      </PageBar>

      <div className="px-4 sm:px-6 lg:px-8">
        {tab === "transactions" ? (
          <section className="panel">
            {!rows.length ? (
              <EmptyPanel icon="activity" title="No transactions yet" action={<UploadButton />}>Upload a bank or card statement. Only the transactions you approve during import are saved, in this browser.</EmptyPanel>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b rule px-3 py-2.5">
                  <label className="relative min-w-[220px] flex-1 basis-full sm:basis-auto">
                    <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
                    <input className="input pl-8" placeholder="Search merchant or description" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} aria-label="Search transactions" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <div className="seg" role="group" aria-label="Direction">
                      {([["all", "All"], ["debit", "Money out"], ["credit", "Money in"]] as [Dir, string][]).map(([k, l]) => (
                        <button key={k} aria-pressed={dir === k} onClick={() => setDir(k)}>{l}</button>
                      ))}
                    </div>
                    <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                      <option value="all">All categories</option>
                      {categories.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                      <option value="all">All months</option>
                      {months.map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}
                    </select>
                    <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                      <option value="new">Newest first</option>
                      <option value="old">Oldest first</option>
                      <option value="high">Largest amount</option>
                      <option value="low">Smallest amount</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 border-b rule bg-paper-2/40 px-4 py-2 text-[12.5px] text-muted">
                  <span><span className="num text-ink">{filtered.length}</span> shown</span>
                  <span>Out <span className="num text-ink">{fmt(totals.out)}</span></span>
                  <span>In <span className="num text-accent">{fmt(totals.in)}</span></span>
                </div>
                {!filtered.length ? (
                  <EmptyPanel icon="search" title="No transactions match these filters" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Description</th>
                          <th className="hidden md:table-cell">Category</th>
                          <th className="hidden xl:table-cell">Statement</th>
                          <th className="r">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, limit).map(({ t, category: cat, bill }) => {
                          const credit = (t.direction ?? "debit") === "credit";
                          return (
                            <tr key={t.id} data-href onClick={() => setOpen(t)}>
                              <td className="num whitespace-nowrap text-muted">{date(t.date)}</td>
                              <td>
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <Avatar name={bill?.displayName ?? payeeName(t.merchant)} size={28} />
                                  <div className="min-w-0">
                                    <div className="max-w-[46vw] truncate font-medium sm:max-w-[340px]">{bill?.displayName ?? payeeName(t.merchant)}</div>
                                    <div className="max-w-[46vw] truncate text-[12px] text-muted sm:max-w-[340px]">{t.description}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="hidden md:table-cell">
                                <span className="text-ink-2">{cat}</span>
                                {bill && <span className="ml-1.5 tag">Bill</span>}
                              </td>
                              <td className="hidden max-w-[160px] truncate text-[12.5px] text-muted xl:table-cell">{sourceOf(t)}</td>
                              <td className={`r num whitespace-nowrap ${credit ? "text-accent" : ""}`}>{credit ? "+" : "−"}{money(t.amount, t.currency)}{t.currency !== state.settings.homeCurrency && <div className="text-[11px] text-muted">{t.currency}</div>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filtered.length > limit && (
                      <div className="border-t rule px-4 py-3 text-center">
                        <button className="btn btn-ghost btn-sm" onClick={() => setLimit((l) => l + 200)}>Show more ({filtered.length - limit} left)</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        ) : (
          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b rule px-3 py-2.5">
              <div className="seg" role="group" aria-label="Payment status">
                {([["all", "All"], ["prepared", "Drafts"], ["pending", "Processing"], ["confirmed", "Paid"], ["failed", "Failed"]] as ["all" | PaymentStatus, string][]).map(([k, l]) => (
                  <button key={k} aria-pressed={payStatus === k} onClick={() => setPayStatus(k)}>{l}</button>
                ))}
              </div>
              <span className="text-[12px] text-muted">Paid means a Celo mainnet receipt exists for every step.</span>
            </div>
            {!state.payments.length ? (
              <EmptyPanel icon="wallet" title="No payments yet" action={<Link href="/bills" className="btn btn-ghost">Choose a bill to pay</Link>}>
                Payments appear here once you prepare one from a bill. Nothing is shown as paid without an on-chain receipt.
              </EmptyPanel>
            ) : !payments.length ? (
              <EmptyPanel icon="search" title="No payments with this status" />
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Payee</th>
                      <th className="hidden md:table-cell">You send</th>
                      <th className="r">Recipient gets</th>
                      <th className="hidden lg:table-cell">Transactions</th>
                      <th>Status</th>
                      <th className="r"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num whitespace-nowrap text-muted">{date(p.createdAt.slice(0, 10))}</td>
                        <td>
                          <Link href={`/activity/${p.id}`} className="font-medium hover:underline">{p.merchant}</Link>
                          <div className="text-[12px] text-muted">{p.method === "x402" ? "x402" : "Direct transfer"}{p.sourceToken !== p.destinationToken ? " · Textile FX" : ""}</div>
                        </td>
                        <td className="hidden num whitespace-nowrap md:table-cell">{p.sourceAmount} {TOKENS[p.sourceToken].display}</td>
                        <td className="r num whitespace-nowrap">{p.destinationAmount} {TOKENS[p.destinationToken].display}</td>
                        <td className="hidden lg:table-cell">
                          <div className="flex flex-col gap-0.5">
                            {p.steps.filter((s) => s.hash).map((s, i) => <span key={i} className="text-[12px]"><span className="text-muted capitalize">{s.kind}</span> <HashLink hash={s.hash!} n={4} /></span>)}
                            {!p.steps.some((s) => s.hash) && <span className="text-[12px] text-faint">Not broadcast</span>}
                          </div>
                        </td>
                        <td><PayStatus status={p.status} /></td>
                        <td className="r whitespace-nowrap">
                          {p.status === "prepared" ? (
                            <span className="inline-flex gap-1.5">
                              <Link href={`/pay/${encodeURIComponent(p.subscriptionId)}`} className="btn btn-primary btn-sm">Review</Link>
                              <button className="btn btn-quiet btn-sm" onClick={() => removePayment(p.id)}>Discard</button>
                            </span>
                          ) : (
                            <Link href={`/activity/${p.id}`} className="btn btn-ghost btn-sm">Receipt</Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
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
          <span className="label">Transaction</span>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <Avatar name={bill?.displayName ?? payeeName(t.merchant)} size={40} />
            <div className="min-w-0">
              <div className="truncate text-[16px] font-semibold">{bill?.displayName ?? payeeName(t.merchant)}</div>
              <div className="text-[13px] text-muted">{date(t.date, "long")}</div>
            </div>
          </div>
          <div className={`figure mt-6 text-[34px] ${credit ? "text-accent" : ""}`}>{credit ? "+" : "−"}{money(t.amount, t.currency)}</div>
          <dl className="mt-6 divide-y divide-[var(--color-rule)] border-y rule text-[13.5px]">
            {[
              ["Statement description", t.description],
              ["Direction", credit ? "Money in" : "Money out"],
              ["Category", category],
              ["Currency", t.currency],
              ["Status", "Posted on statement"],
              ["Statement", source],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="shrink-0 text-muted">{k}</dt><dd className="text-right break-words">{v}</dd></div>
            ))}
          </dl>
          {bill ? (
            <Link href={`/bills/${encodeURIComponent(bill.id)}`} className="mt-5 flex items-center justify-between rounded-[6px] border rule px-4 py-3 text-[13.5px] hover:bg-paper-2">
              <span>Part of <strong className="font-semibold">{bill.displayName}</strong> · {bill.chargeCount} charges</span>
              <Icon name="arrow" size={15} />
            </Link>
          ) : (
            !credit && sameMerchant > 0 && <p className="mt-5 text-[13px] text-muted">{sameMerchant} other transaction{sameMerchant === 1 ? "" : "s"} from this merchant. Not regular enough to count as a bill.</p>
          )}
          <Link href={`/agent?q=${encodeURIComponent(`Tell me about my payments to ${bill?.displayName ?? payeeName(t.merchant)}`)}`} className="btn btn-ghost mt-4 w-full">Ask the agent about this payee</Link>
        </div>
      </aside>
    </div>
  );
}
