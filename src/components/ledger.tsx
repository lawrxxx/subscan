"use client";
import Link from "next/link";
import { monthlyEquivalent, toHome } from "@/lib/detection/analysis";
import { date, FREQ_LABEL, money, PER } from "@/lib/format";
import type { Subscription } from "@/lib/types";
import { Confidence, StatusTag } from "./bits";

export function Ledger({
  list,
  home,
  rates,
  onStatus,
  empty = "Nothing matches these filters.",
}: {
  list: Subscription[];
  home: string;
  rates: Record<string, number>;
  onStatus(id: string, s: Subscription["status"]): void;
  empty?: string;
}) {
  if (!list.length) return <p className="border-t border-ink py-10 text-[14px] text-muted">{empty}</p>;
  return (
    <div className="border-t border-ink">
      <div className="hidden grid-cols-[1.6fr_0.8fr_0.9fr_0.9fr_0.9fr_0.7fr_150px] gap-4 border-b rule py-2 text-[11px] uppercase tracking-[0.1em] text-muted md:grid">
        <span>Merchant</span>
        <span>Cadence</span>
        <span>Next renewal</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Per year ({home})</span>
        <span>Confidence</span>
        <span className="text-right">Status</span>
      </div>
      <ul>
        {list.map((s) => {
          const yearly = toHome(monthlyEquivalent(s) * 12, s.currency, home, rates);
          return (
            <li
              key={s.id}
              className="group grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b rule py-3.5 transition-colors hover:bg-paper-2/50 md:grid-cols-[1.6fr_0.8fr_0.9fr_0.9fr_0.9fr_0.7fr_150px] md:items-center md:px-1"
            >
              <Link href={`/subscriptions/${encodeURIComponent(s.id)}`} className="min-w-0">
                <div className="truncate text-[15px] font-medium group-hover:underline">{s.displayName}</div>
                <div className="text-[12px] text-muted">
                  {s.category}
                  {s.billType === "variable" && <> · <span className="text-ink-2">varies</span></>}
                  {s.manual && <> · added by you</>}
                  {s.missed && <> · <span className="text-alert">expected payment missing</span></>}
                  {s.international && <> · <span className="text-ink-2">{s.currency}</span></>}
                  {s.priceChange && s.priceChange.pct > 0 && <> · <span className="text-alert">price up</span></>}
                  {s.payment && <> · <span className="text-accent">payable on Celo</span></>}
                  {s.lapsed && <> · <span className="text-amber">possibly cancelled</span></>}
                </div>
              </Link>
              <div className="num text-right text-[15px] md:hidden">
                {money(s.amount, s.currency)}
                <span className="text-muted">{PER[s.frequency]}</span>
              </div>
              <span className="hidden text-[13px] md:block">{FREQ_LABEL[s.frequency]}</span>
              <span className={`num text-[12px] md:text-[13px] ${s.lapsed ? "text-faint line-through" : "text-muted md:text-ink"}`} title={s.lapsed ? "No recent charge — renewal may not happen" : "Estimated"}>{date(s.nextRenewal)}</span>
              <span className="num hidden text-right text-[14px] md:block">{s.billType === "variable" ? "≈" : ""}{money(s.amount, s.currency)}</span>
              <span className="num hidden text-right text-[13px] text-muted md:block">{yearly === null ? "—" : money(yearly, home)}</span>
              <span className="hidden md:block"><Confidence value={s.confidence} /></span>
              <div className="col-span-2 flex items-center justify-start gap-2 md:col-span-1 md:justify-end">
                {s.status === "detected" ? (
                  <>
                    <button onClick={() => onStatus(s.id, "confirmed")} className="tag hover:border-accent hover:text-accent">Confirm</button>
                    <button onClick={() => onStatus(s.id, "dismissed")} className="tag hover:border-alert hover:text-alert">Dismiss</button>
                  </>
                ) : (
                  <>
                    <StatusTag status={s.status} />
                    <button onClick={() => onStatus(s.id, "detected")} className="text-[11px] text-muted link">undo</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
