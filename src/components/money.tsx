"use client";
import Link from "next/link";
import { date } from "@/lib/format";
import type { accessState } from "@/lib/money/runner";
import type { Activity } from "@/lib/types";
import { Amount, Icon, StatusPill } from "./ui";

export function AccessStrip({ access, expiry }: { access: ReturnType<typeof accessState>; expiry?: number }) {
  const map = {
    none: ["callout-amber", "subscan can't move money yet", "Give access with your limits to switch on rules and transfers.", "Give access"],
    revoked: ["callout-amber", "Access revoked", "Nothing runs until you give access again.", "Give access"],
    expired: ["callout-amber", "Access expired", "Nothing runs until you renew it.", "Renew"],
    off: ["callout-amber", "Automation is paused", "Rules and transfers won't run until you switch it back on.", "Turn on"],
    on: ["callout-sage", "Automation is on", `Runs while subscan is open${expiry ? ` · access until ${date(new Date(expiry * 1000).toISOString().slice(0, 10))}` : ""}.`, "Manage"],
  } as const;
  const [cls, title, sub, cta] = map[access];
  return (
    <Link href="/payment-wallet" className={`callout ${cls} hover:brightness-[0.98]`}>
      <span className="flex min-w-0 items-center gap-3"><span className="tile bg-surface"><Icon name={access === "on" ? "check" : "shield"} size={17} /></span><span className="min-w-0"><span className="block font-semibold">{title}</span><span className="block text-[12.5px] text-ink-2">{sub}</span></span></span>
      <span className="shrink-0 text-[12.5px] font-semibold text-accent">{cta}</span>
    </Link>
  );
}

export function ActivityRows({ items }: { items: Activity[] }) {
  return (
    <ul className="rows">
      {items.map((a) => (
        <li key={a.id}>
          <Link href={`/history/${a.id}`} className="row">
            <span className="flex min-w-0 items-center gap-3">
              <span className={`tile h-9 w-9 ${a.kind === "conversion" ? "bg-sand-wash text-ink-2" : "bg-paper-2 text-ink-2"}`}><Icon name={a.kind === "conversion" ? "swap" : "out"} size={16} /></span>
              <span className="min-w-0">
                <span className="row-title">{a.kind === "conversion" ? `Convert ${a.token === "USDT" ? "USD₮" : "cNGN"} to ${a.toToken === "USDT" ? "USD₮" : "cNGN"}` : `To ${a.recipientName ?? "recipient"}`}</span>
                <span className="row-sub">{new Date(a.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{a.occurrence ? ` · for ${date(a.occurrence, "day")}` : ""}</span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {a.amount ? <Amount value={a.amount} token={a.token} className="row-amount" /> : <span className="row-amount text-muted">—</span>}
              <StatusPill status={a.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
