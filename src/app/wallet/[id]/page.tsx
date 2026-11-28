"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { verifyTx } from "@celo/attribution-tags";
import { addressUrl, TOKENS } from "@/lib/celo/config";
import { publicClient } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";
import { Missing } from "@/components/empty";
import { HashLink, TxStatus } from "@/components/bits";

export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, upsertPayment } = useStore();
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

  // Read each transaction back from Celo and decode its ERC-8021 attribution tag.
  const [attr, setAttr] = useState<Record<string, string[] | null>>({});
  const hashes = (p?.steps ?? []).map((s) => s.hash).filter(Boolean).join(",");
  useEffect(() => {
    if (!hashes) return;
    let live = true;
    Promise.all(
      hashes.split(",").map(async (h) => {
        try {
          // verifyTx also decodes smart-account (ERC-4337) and relayed-wallet transactions.
          const r = await verifyTx({ client: publicClient as unknown as Parameters<typeof verifyTx>[0]["client"], hash: h as `0x${string}` });
          return [h, r?.codes ?? null] as const;
        } catch {
          return [h, undefined] as const;
        }
      }),
    ).then((rows) => live && setAttr(Object.fromEntries(rows.filter(([, v]) => v !== undefined)) as Record<string, string[] | null>));
    return () => {
      live = false;
    };
  }, [hashes]);

  if (!ready) return null;
  if (!p) return <Missing what="receipt" back="/spending" backLabel="Back to activity" />;
  const created = new Date(p.createdAt);
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 text-[13px]"><Link href="/settings" className="text-muted link">Settings</Link> <span className="text-faint">/</span> <Link href="/wallet" className="text-muted link">Wallet</Link> <span className="text-faint">/</span> Receipt</div>
      <article className="panel mx-auto max-w-2xl">
        <header className="flex items-start justify-between border-b rule px-6 py-5 sm:px-8">
          <div>
            <div className="label mb-2">{p.status === "prepared" ? "Prepared payment · not broadcast" : p.status === "confirmed" ? "Receipt · Celo mainnet" : "Payment · Celo mainnet"}</div>
            <h1 className="title text-[28px]">{p.merchant}</h1>
            <div className="mt-1 text-[13px] text-muted">{created.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}</div>
          </div>
          <TxStatus status={p.status} />
        </header>
        <div className="px-6 py-6 sm:px-8">
          <div className="label mb-1">{p.status === "confirmed" ? "Merchant received" : "Merchant will receive"}</div>
          <div className="figure text-[40px]">{p.destinationAmount}<span className="ml-2 text-[0.35em] text-muted">{TOKENS[p.destinationToken].display}</span></div>
          <dl className="mt-6 border-t rule text-[14px]">
            {[
              [p.status === "confirmed" ? "Paid from" : "Pays from", `${p.sourceAmount} ${TOKENS[p.sourceToken].display}`],
              ...(p.rate ? [[p.status === "prepared" ? "Rate" : "Rate (firm quote)", p.rate]] : []),
              ...(p.feeAmount ? [["Textile FX fee", p.feeAmount]] : []),
              ["Method", p.method === "x402" ? "x402" : "Direct transfer"],
              ...(p.rfqId ? [["Textile RFQ", p.rfqId]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">{k}</dt><dd className="num text-right">{v}</dd></div>
            ))}
            {p.recipient && <div className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">Recipient</dt><dd><a href={addressUrl(p.recipient)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{p.recipient.slice(0, 10)}…{p.recipient.slice(-6)} ↗</a></dd></div>}
            {p.from && <div className="flex justify-between gap-4 border-b rule py-2.5"><dt className="text-muted">From wallet</dt><dd><a href={addressUrl(p.from)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{p.from.slice(0, 10)}…{p.from.slice(-6)} ↗</a></dd></div>}
          </dl>
          <h2 className="label mt-8 mb-2">Transactions</h2>
          <ol className="border-t rule">
            {p.steps.map((s, i) => (
              <li key={i} className="border-b rule py-3">
                <div className="flex items-center justify-between gap-3"><span className="text-[14px]">{s.label}</span><TxStatus status={s.status} /></div>
                <div className="mt-1 flex items-center justify-between text-[12px] text-muted">
                  {s.hash ? <HashLink hash={s.hash} n={10} /> : <span>Not broadcast</span>}
                  {s.at && <span className="num">{new Date(s.at).toLocaleTimeString("en-GB")}</span>}
                </div>
                {s.error && <div className="mt-1 text-[12px] text-alert">{s.error}</div>}
                {s.hash && s.hash in attr && (
                  <div className="mt-1 text-[11px] text-muted">
                    Attribution (ERC-8021):{" "}
                    {attr[s.hash] ? <span className="text-accent">{attr[s.hash]!.join(", ")} ✓</span> : <span>none{p.method === "x402" && s.kind === "settlement" ? " — submitted by the x402 facilitator" : ""}</span>}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {p.status === "prepared" && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-amber-wash px-4 py-3 text-[13px]">
              <span>Nothing has been signed. Amounts are indicative until a firm quote is taken.</span>
              <Link href={`/pay/${encodeURIComponent(p.subscriptionId)}`} className="btn btn-primary btn-sm">Continue to approval</Link>
            </div>
          )}
          <p className="mt-6 text-[11px] text-muted">Status is read from Celo mainnet receipts. Hashes link to Celoscan.</p>
        </div>
      </article>
    </div>
  );
}
