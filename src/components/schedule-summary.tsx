"use client";
import type { AppState, Recipient } from "@/lib/types";
import { accessState } from "@/lib/money/runner";
import { transferCap } from "@/lib/money/rules";
import { describe, datesBetween } from "@/lib/money/schedule";
import { date } from "@/lib/format";
import type { ScheduleDetails } from "./schedule-form";
import { AddressBlock } from "./recipients";
import { Icon } from "./ui";

/** Everything the user is agreeing to, plus any reason it won't run. */
export function ScheduleSummary({ state, recipient, d }: { state: AppState; recipient: Recipient; d: ScheduleDetails }) {
  const unit = d.token === "USDT" ? "USD₮" : "cNGN";
  const amt = Number(d.amount);
  const access = accessState(state);
  const walletCap = Number(state.autopilot?.maxPerTransfer?.[d.token]) || undefined;
  const ruleCap = transferCap(state.rules, d.token);
  const monthly = Number(state.autopilot?.limits?.[d.token]) || 0;
  const firstFew = datesBetween({ frequency: d.frequency, firstDate: d.firstDate, endDate: d.endDate }, d.firstDate, "9999-12-31", 3);
  const checks: [boolean, string][] = [
    [!!recipient.confirmedAt, recipient.confirmedAt ? "Recipient address confirmed" : "Recipient address not confirmed"],
    [access === "on", access === "on" ? "subscan has access to your payment wallet" : access === "off" ? "Automation is paused: it won't run until you turn it on" : access === "expired" ? "Access has expired: renew it before the first date" : "subscan doesn't have access yet: set up your payment wallet"],
    [!walletCap || amt <= walletCap, !walletCap ? "No per-transfer cap on your payment wallet" : amt <= walletCap ? `Within your per-transfer cap of ${walletCap.toLocaleString("en-US")} ${unit}` : `Above your per-transfer cap of ${walletCap.toLocaleString("en-US")} ${unit}: it will be refused`],
    [!ruleCap || amt <= ruleCap, !ruleCap ? "No money rule limits this transfer" : amt <= ruleCap ? `Within your money rule's limit of ${ruleCap.toLocaleString("en-US")} ${unit}` : `Above your money rule's limit of ${ruleCap.toLocaleString("en-US")} ${unit}: it will be blocked`],
    [!monthly || amt <= monthly, !monthly ? "No monthly limit set yet" : amt <= monthly ? `Within your monthly limit of ${monthly.toLocaleString("en-US")} ${unit}` : `Above your monthly limit of ${monthly.toLocaleString("en-US")} ${unit}: it will be refused`],
  ];
  return (
    <div className="space-y-3">
      <section className="panel px-4 py-4">
        <div className="text-[13px] text-muted">You&rsquo;re scheduling</div>
        <div className="figure mt-1 text-[28px]">{amt.toLocaleString("en-US")} {unit}</div>
        <div className="mt-1 text-[14px]">to <span className="font-semibold">{recipient.name}</span> · {describe(d).toLowerCase()}</div>
        <div className="mt-3"><AddressBlock address={recipient.address} /></div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div><dt className="text-muted">First transfer</dt><dd>{date(d.firstDate)}</dd></div>
          <div><dt className="text-muted">Ends</dt><dd>{d.frequency === "once" ? "After this one" : d.endDate ? date(d.endDate) : "When you cancel"}</dd></div>
          {d.maxTotal && <div><dt className="text-muted">Stops after</dt><dd>{Number(d.maxTotal).toLocaleString("en-US")} {unit} in total</dd></div>}
          <div><dt className="text-muted">Most per transfer</dt><dd>{Number(d.txLimit ?? d.amount).toLocaleString("en-US")} {unit}</dd></div>
        </dl>
        {firstFew.length > 1 && <p className="mt-3 text-[12.5px] text-muted">Next dates: {firstFew.map((x) => date(x, "day")).join(", ")}</p>}
      </section>
      <ul className="panel rows text-[13px]">
        {checks.map(([ok, text]) => (
          <li key={text} className="flex items-start gap-2.5 px-4 py-2.5"><Icon name={ok ? "check" : "alert"} size={16} className={`mt-0.5 shrink-0 ${ok ? "text-positive" : "text-amber"}`} />{text}</li>
        ))}
      </ul>
      <p className="px-1 text-[12.5px] text-muted">Transfers go out while subscan is open in a browser on the day, or within 3 days after. Anything later waits for your OK. You&rsquo;ll see each transfer&rsquo;s result in activity.</p>
    </div>
  );
}
