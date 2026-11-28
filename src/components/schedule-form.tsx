"use client";
import { useState } from "react";
import type { Frequency, TokenSymbol, TransferSchedule } from "@/lib/types";

export interface ScheduleDetails {
  token: TokenSymbol;
  amount: string;
  frequency: Frequency;
  firstDate: string;
  endDate?: string;
  maxTotal?: string;
  txLimit?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function ScheduleFields({ initial, lockStart, onSubmit, onBack, submitLabel }: { initial?: Partial<TransferSchedule>; lockStart?: boolean; onSubmit(d: ScheduleDetails): void; onBack(): void; submitLabel: string }) {
  const [token, setToken] = useState<TokenSymbol>(initial?.token ?? "cNGN");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "monthly");
  const [firstDate, setFirstDate] = useState(initial?.firstDate ?? today());
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [maxTotal, setMaxTotal] = useState(initial?.maxTotal ?? "");
  const [txLimit, setTxLimit] = useState(initial?.txLimit ?? "");
  const [err, setErr] = useState<string>();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const pos = (v: string) => Number(v) > 0 && Number.isFinite(Number(v));
        if (!pos(amount)) return setErr("Enter an amount.");
        if (!lockStart && firstDate < today()) return setErr("The first transfer can't be in the past.");
        if (endDate && endDate < firstDate) return setErr("The end date is before the first transfer.");
        if (maxTotal && !pos(maxTotal)) return setErr("The maximum total must be a positive number.");
        if (maxTotal && Number(maxTotal) < Number(amount)) return setErr("The maximum total is smaller than one transfer.");
        if (txLimit && !pos(txLimit)) return setErr("The transfer limit must be a positive number.");
        if (txLimit && Number(amount) > Number(txLimit)) return setErr("The amount is above your limit for one transfer.");
        onSubmit({ token, amount: String(Number(amount)), frequency, firstDate, endDate: endDate || undefined, maxTotal: maxTotal ? String(Number(maxTotal)) : undefined, txLimit: txLimit ? String(Number(txLimit)) : String(Number(amount)) });
      }}
    >
      <section className="panel space-y-4 px-4 py-4">
        <div>
          <div className="text-[12.5px] text-muted">Send in</div>
          <div className="seg mt-1">{(["cNGN", "USDT"] as const).map((t) => <button key={t} type="button" aria-pressed={token === t} onClick={() => setToken(t)}>{t === "USDT" ? "US dollars (USD₮)" : "Naira (cNGN)"}</button>)}</div>
        </div>
        <label className="block text-[12.5px] text-muted">Amount ({token === "USDT" ? "USD₮" : "cNGN"})<input className="input num mt-1 text-[18px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={token === "USDT" ? "20" : "5000"} /></label>
        <div>
          <div className="text-[12.5px] text-muted">How often</div>
          <div className="seg mt-1">{(["once", "weekly", "monthly"] as const).map((f) => <button key={f} type="button" aria-pressed={frequency === f} onClick={() => setFrequency(f)}>{f === "once" ? "Once" : f === "weekly" ? "Every week" : "Every month"}</button>)}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[12.5px] text-muted">{frequency === "once" ? "Date" : "First transfer"}<input type="date" className="input mt-1" value={firstDate} min={lockStart ? undefined : today()} disabled={lockStart} onChange={(e) => setFirstDate(e.target.value)} /></label>
          {frequency !== "once" && <label className="block text-[12.5px] text-muted">End date (optional)<input type="date" className="input mt-1" value={endDate} min={firstDate} onChange={(e) => setEndDate(e.target.value)} /></label>}
        </div>
      </section>
      <details className="panel px-4 py-3" open={!!(initial?.maxTotal || (initial?.txLimit && initial.txLimit !== initial.amount))}>
        <summary className="cursor-pointer text-[13.5px] font-medium">Spending limits</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {frequency !== "once" && <label className="block text-[12.5px] text-muted">Stop after sending a total of (optional)<input className="input num mt-1" inputMode="decimal" value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} placeholder="No limit" /></label>}
          <label className="block text-[12.5px] text-muted">Never send more than this in one transfer<input className="input num mt-1" inputMode="decimal" value={txLimit} onChange={(e) => setTxLimit(e.target.value)} placeholder={amount || "Same as the amount"} /></label>
        </div>
      </details>
      {err && <p className="px-1 text-[13px] text-alert" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button className="btn btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
