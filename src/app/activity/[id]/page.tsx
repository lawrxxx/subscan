"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { addressUrl, TOKENS } from "@/lib/celo/config";
import { publicClient } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";
import { HashLink, TxStatus } from "@/components/bits";

export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const { state, upsertPayment } = useStore();
  const p = state.payments.find((x) => x.id === id);

  // Re-check pending hashes against the chain; never mark success without a receipt.
  useEffect(() => {
    if (!p || !p.steps.some((s) => s.status === "pending" && s.hash)) return;
    let stop = false;
    (async () => {
      const steps = await Promise.all(
        p.steps.map(async (s) => {
          if (s.status !== "pending" || !s.hash) return s;
          try {
            const r = await publicClient.getTransactionReceipt({ hash: s.hash });
            return { ...s, status: r.status === "success" ? ("confirmed" as const) : ("failed" as const), error: r.status === "success" ? undefined : "Reverted on chain" };
          } catch {
            return s;
          }
        }),
      );
      if (stop) return;
      const changed = steps.some((s, i) => s.status !== p.steps[i].status);
      if (changed) {
        const status = steps.some((s) => s.status === "failed") ? "failed" : steps.every((s) => s.status === "confirmed") ? "confirmed" : "pending";
        upsertPayment({ ...p, steps, status });
      }
    })();
    return () => {
      stop = true;
    };
  }, [p, upsertPayment]);

  if (!p) return <div className="px-12 py-16 text-muted">Receipt not found. <Link href="/activity" className="link">All payments</Link></div>;
  const created = new Date(p.createdAt);
  return (
    <div className="px-4 py-10 sm:px-8 lg:px-12">
      <div className="mb-6 text-[13px]"><Link href="/activity" className="text-muted link">Payments</Link> <span className="text-faint">/</span> Receipt</div>
      <article className="mx-auto max-w-2xl border border-ink bg-[#faf8f3]">
        <header className="flex items-start justify-between border-b border-ink px-6 py-6 sm:px-8">
          <div>
            <div className="kicker mb-2">Receipt · Celo mainnet</div>
            <h1 className="display text-[36px]">{p.merchant}</h1>
            <div className="mt-1 text-[13px] text-muted">{created.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}</div>
          </div>
          <TxStatus status={p.status} />
        </header>
        <div className="px-6 py-6 sm:px-8">
          <div className="kicker mb-1">Merchant received</div>
          <div className="figure text-[64px]">{p.destinationAmount}<span className="ml-2 text-[0.35em] text-muted">{TOKENS[p.destinationToken].display}</span></div>
          <dl className="mt-6 border-t rule text-[14px]">
            {[
              ["Paid from", `${p.sourceAmount} ${TOKENS[p.sourceToken].display}`],
              ...(p.rate ? [["Rate (firm quote)", p.rate]] : []),
              ...(p.feeAmount ? [["Textile FX fee", p.feeAmount]] : []),
              ["Method", p.method === "x402" ? "x402" : "Direct transfer"],
              ...(p.rfqId ? [["Textile RFQ", p.rfqId]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">{k}</dt><dd className="num text-right">{v}</dd></div>
            ))}
            {p.recipient && <div className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">Recipient</dt><dd><a href={addressUrl(p.recipient)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{p.recipient.slice(0, 10)}…{p.recipient.slice(-6)} ↗</a></dd></div>}
            {p.from && <div className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">From wallet</dt><dd><a href={addressUrl(p.from)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{p.from.slice(0, 10)}…{p.from.slice(-6)} ↗</a></dd></div>}
          </dl>
          <h2 className="kicker mt-8 mb-2">Transactions</h2>
          <ol className="border-t border-ink">
            {p.steps.map((s, i) => (
              <li key={i} className="border-b rule py-3">
                <div className="flex items-center justify-between gap-3"><span className="text-[14px]">{s.label}</span><TxStatus status={s.status} /></div>
                <div className="mt-1 flex items-center justify-between text-[12px] text-muted">
                  {s.hash ? <HashLink hash={s.hash} n={10} /> : <span>Not broadcast</span>}
                  {s.at && <span className="num">{new Date(s.at).toLocaleTimeString("en-GB")}</span>}
                </div>
                {s.error && <div className="mt-1 text-[12px] text-alert">{s.error}</div>}
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[11px] text-muted">Status is read from Celo mainnet receipts. Hashes link to Celoscan.</p>
        </div>
      </article>
    </div>
  );
}
