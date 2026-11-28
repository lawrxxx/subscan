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
const unit = (t: TokenSymbol) => (t === "USDT" ? "USD₮" : "cNGN");

/**
 * Transfer details. `part` shows "amount" (token, amount, per-transfer limit),
 * "when" (frequency, dates, total) or "all" (editing). Tokens are limited to what
 * the recipient's destination accepts.
 */
export function ScheduleFields({ initial, tokens = ["cNGN", "USDT"], part = "all", lockStart, onSubmit, onBack, submitLabel }: { initial?: Partial<TransferSchedule>; tokens?: TokenSymbol[]; part?: "amount" | "when" | "all"; lockStart?: boolean; onSubmit(d: ScheduleDetails): void; onBack(): void; submitLabel: string }) {
  const [token, setToken] = useState<TokenSymbol>(initial?.token && tokens.includes(initial.token) ? initial.token : tokens[0]);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "monthly");
  const [firstDate, setFirstDate] = useState(initial?.firstDate ?? today());
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [maxTotal, setMaxTotal] = useState(initial?.maxTotal ?? "");
  const [txLimit, setTxLimit] = useState(initial?.txLimit && initial.txLimit !== initial.amount ? initial.txLimit : "");
  const [err, setErr] = useState<string>();
  const showAmount = part !== "when";
  const showWhen = part !== "amount";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const pos = (v: string) => Number(v) > 0 && Number.isFinite(Number(v));
        if (showAmount) {
          if (!tokens.includes(token)) return setErr("This recipient can't receive that token on Celo.");
          if (!pos(amount)) return setErr("Enter an amount.");
          if (txLimit && !pos(txLimit)) return setErr("The transfer limit must be a positive number.");
          if (txLimit && Number(amount) > Number(txLimit)) return setErr("The amount is above your limit for one transfer.");
        }
        if (showWhen) {
          if (!lockStart && firstDate < today()) return setErr("The first transfer can't be in the past.");
          if (endDate && endDate < firstDate) return setErr("The end date is before the first transfer.");
          if (maxTotal && !pos(maxTotal)) return setErr("The maximum total must be a positive number.");
          if (maxTotal && Number(maxTotal) < Number(amount || initial?.amount || 0)) return setErr("The maximum total is smaller than one transfer.");
        }
        const amt = String(Number(amount || initial?.amount));
        onSubmit({ token, amount: amt, frequency, firstDate, endDate: frequency === "once" ? undefined : endDate || undefined, maxTotal: frequency !== "once" && maxTotal ? String(Number(maxTotal)) : undefined, txLimit: txLimit ? String(Number(txLimit)) : amt });
      }}
    >
      {showAmount && (
        <section className="panel space-y-4 px-4 py-4">
          {tokens.length > 1 ? (
            <div>
              <div className="text-[12.5px] text-muted">Send in</div>
              <div className="seg mt-1">{tokens.map((t) => <button key={t} type="button" aria-pressed={token === t} onClick={() => setToken(t)}>{t === "USDT" ? "US dollars (USD₮)" : "Naira (cNGN)"}</button>)}</div>
            </div>
          ) : (
            <div className="text-[13px] text-muted">Sent in <span className="font-medium text-ink">{token === "USDT" ? "US dollars (USD₮)" : "naira (cNGN)"}</span> on Celo, the only token this recipient can receive.</div>
          )}
          <label className="block text-[12.5px] text-muted">Amount ({unit(token)})<input className="input num mt-1 text-[18px]" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={token === "USDT" ? "20" : "5000"} /></label>
          <label className="block text-[12.5px] text-muted">Never send more than this in one transfer (optional)<input className="input num mt-1" inputMode="decimal" value={txLimit} onChange={(e) => setTxLimit(e.target.value)} placeholder={amount ? `${amount} (the amount)` : "Same as the amount"} /></label>
        </section>
      )}
      {showWhen && (
        <section className="panel space-y-4 px-4 py-4">
          <div>
            <div className="text-[12.5px] text-muted">How often</div>
            <div className="seg mt-1">{(["once", "weekly", "monthly"] as const).map((f) => <button key={f} type="button" aria-pressed={frequency === f} onClick={() => setFrequency(f)}>{f === "once" ? "Once" : f === "weekly" ? "Every week" : "Every month"}</button>)}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[12.5px] text-muted">{frequency === "once" ? "Date" : "First transfer"}<input type="date" className="input mt-1" value={firstDate} min={lockStart ? undefined : today()} disabled={lockStart} onChange={(e) => setFirstDate(e.target.value)} /></label>
            {frequency !== "once" && <label className="block text-[12.5px] text-muted">End date (optional)<input type="date" className="input mt-1" value={endDate} min={firstDate} onChange={(e) => setEndDate(e.target.value)} /></label>}
          </div>
          {frequency !== "once" && <label className="block text-[12.5px] text-muted">Stop after sending a total of (optional)<input className="input num mt-1" inputMode="decimal" value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} placeholder="No limit" /></label>}
        </section>
      )}
      {err && <p className="px-1 text-[13px] text-alert" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button className="btn btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
