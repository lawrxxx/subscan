"use client";
import Link from "next/link";
import { PageHeader } from "@/components/shell";
import { HashLink, TxStatus } from "@/components/bits";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import type { PaymentStep } from "@/lib/types";

const KIND: Record<PaymentStep["kind"], string> = { approval: "Approval", conversion: "Conversion", settlement: "Settlement" };

export default function Activity() {
  const { state } = useStore();
  const rows = state.payments.flatMap((p) => p.steps.map((s, i) => ({ p, s, i })));
  return (
    <div>
      <PageHeader kicker="Payments" title="Transaction history">
        Every transaction subscan prepared or sent from your wallet on Celo mainnet. Prepared means nothing was broadcast; pending means it is waiting for a block.
      </PageHeader>
      <div className="px-4 py-8 sm:px-8 lg:px-12">
        {!rows.length ? (
          <p className="text-[14px] text-muted">No payments yet. Prepare one from a subscription or ask the <Link href="/agent" className="link">agent</Link>.</p>
        ) : (
          <div className="border-t border-ink">
            <div className="hidden grid-cols-[110px_1fr_1fr_1.1fr_120px_170px] gap-4 border-b rule py-2 text-[11px] uppercase tracking-[0.1em] text-muted lg:grid">
              <span>Type</span><span>Merchant</span><span>Route</span><span>Amount</span><span>Status</span><span>Celo tx</span>
            </div>
            <ul>
              {rows.map(({ p, s, i }) => (
                <li key={`${p.id}-${i}`} className="grid grid-cols-2 gap-x-4 gap-y-1 border-b rule py-3 text-[14px] lg:grid-cols-[110px_1fr_1fr_1.1fr_120px_170px] lg:items-center">
                  <span className="text-[13px] text-muted">{KIND[s.kind]}</span>
                  <Link href={`/activity/${p.id}`} className="text-right font-medium hover:underline lg:text-left">{p.merchant}</Link>
                  <span className="text-[13px] text-muted">{s.kind === "settlement" ? TOKENS[p.destinationToken].display : `${TOKENS[p.sourceToken].display} → ${TOKENS[p.destinationToken].display}`}</span>
                  <span className="num text-right text-[13px] lg:text-left">
                    {s.kind === "settlement" ? `${p.destinationAmount} ${TOKENS[p.destinationToken].display}` : `${p.sourceAmount} ${TOKENS[p.sourceToken].display}`}
                  </span>
                  <span><TxStatus status={s.status} /></span>
                  <span className="text-right lg:text-left">{s.hash ? <HashLink hash={s.hash} n={5} /> : <span className="text-[12px] text-faint">not broadcast</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
