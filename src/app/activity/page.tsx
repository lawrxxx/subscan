"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell";
import { HashLink, TxStatus } from "@/components/bits";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";

type Tab = "all" | PaymentStatus;
const TABS: [Tab, string][] = [
  ["all", "All"],
  ["prepared", "Prepared"],
  ["pending", "Pending"],
  ["confirmed", "Confirmed"],
  ["failed", "Failed"],
];

export default function Activity() {
  const { state, removePayment } = useStore();
  const [tab, setTab] = useState<Tab>("all");
  const counts = useMemo(() => Object.fromEntries(TABS.map(([k]) => [k, k === "all" ? state.payments.length : state.payments.filter((p) => p.status === k).length])), [state.payments]);
  const list = state.payments.filter((p) => tab === "all" || p.status === tab);
  const next = [...state.subscriptions].filter((s) => s.status !== "dismissed").sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal))[0];

  return (
    <div>
      <PageHeader kicker="Payments" title="Transaction history">
        Every payment subscan prepared or sent from your wallet. <strong className="font-medium text-ink">Prepared</strong> means nothing was signed or broadcast;{" "}
        <strong className="font-medium text-ink">pending</strong> is waiting for a Celo block; <strong className="font-medium text-ink">confirmed</strong> has an on-chain receipt.
      </PageHeader>

      <div className="grid grid-cols-2 border-b rule sm:grid-cols-4">
        {(["prepared", "pending", "confirmed", "failed"] as PaymentStatus[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`border-r rule px-4 py-5 text-left last:border-r-0 sm:px-8 lg:px-12 ${tab === k ? "bg-paper-2" : "hover:bg-paper-2/50"}`}>
            <div className="kicker">{k}</div>
            <div className="figure mt-2 text-[44px]">{counts[k]}</div>
          </button>
        ))}
      </div>

      <div className="px-4 py-8 sm:px-8 lg:px-12">
        <div className="-mx-1 mb-4 flex gap-px overflow-x-auto text-[13px]" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-2.5 py-1.5 ${tab === k ? "border-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {l} <span className="num text-faint">{counts[k]}</span>
            </button>
          ))}
        </div>

        {!state.payments.length ? (
          <div className="border-t border-ink py-10">
            <div className="display text-[28px]">No payments yet.</div>
            <p className="mt-2 max-w-md text-[14px] text-muted">
              Payments appear here once you prepare one. subscan never shows a transaction as confirmed without a Celo mainnet receipt.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {next && <Link href={`/pay/${encodeURIComponent(next.id)}`} className="btn btn-primary">Prepare {next.displayName}</Link>}
              <Link href="/agent" className="btn btn-ghost">Ask the agent</Link>
            </div>
          </div>
        ) : !list.length ? (
          <p className="border-t border-ink py-10 text-[14px] text-muted">No {tab} payments.</p>
        ) : (
          <ul className="border-t border-ink">
            {list.map((p) => (
              <li key={p.id} className="grid gap-4 border-b rule py-5 lg:grid-cols-[1.1fr_1fr_1.4fr]">
                <div>
                  <div className="flex items-center gap-3">
                    <Link href={`/activity/${p.id}`} className="display text-[22px] hover:underline">{p.merchant}</Link>
                    <TxStatus status={p.status} />
                  </div>
                  <div className="mt-1 text-[12px] text-muted">
                    {date(p.createdAt.slice(0, 10))} · {new Date(p.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {p.method === "x402" ? "x402" : "direct transfer"}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 text-[13px]">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.1em] text-muted">From</dt>
                    <dd className="num mt-0.5">{p.sourceAmount} {TOKENS[p.sourceToken].display}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.1em] text-muted">Merchant gets</dt>
                    <dd className="num mt-0.5">{p.destinationAmount} {TOKENS[p.destinationToken].display}</dd>
                  </div>
                </dl>
                <div>
                  <ol className="space-y-1.5">
                    {p.steps.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate text-ink-2">
                          <span className="mr-2 text-[11px] uppercase tracking-[0.08em] text-muted">{s.kind}</span>
                          {s.hash ? <HashLink hash={s.hash} n={4} /> : <span className="text-faint">not broadcast</span>}
                        </span>
                        <TxStatus status={s.status} />
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 flex gap-4 text-[12px]">
                    <Link href={`/activity/${p.id}`} className="link">Receipt</Link>
                    {p.status === "prepared" && (
                      <>
                        <Link href={`/pay/${encodeURIComponent(p.subscriptionId)}`} className="link">Continue to approval</Link>
                        <button className="text-alert link" onClick={() => removePayment(p.id)}>Discard draft</button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
