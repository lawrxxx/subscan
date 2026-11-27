"use client";
import { useState } from "react";
import { CATEGORIES, KIND_LABEL } from "@/lib/detection/merchants";
import { FREQ_LABEL } from "@/lib/format";
import type { BillType, Frequency, ObligationKind, Subscription } from "@/lib/types";

const DAYS: Record<Frequency, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };

/** Manually add a bill that isn't in the statement (e.g. rent paid in cash, a new plan). */
export function AddBill({ home, onAdd, onCancel }: { home: string; onAdd(s: Subscription): void; onCancel(): void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ObligationKind>("subscription");
  const [category, setCategory] = useState(CATEGORIES.subscription[0]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(home);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [billType, setBillType] = useState<BillType>("fixed");
  const [due, setDue] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount.replace(/,/g, ""));
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Give it a name.";
    if (name.trim().length > 80) errs.name = "Keep it under 80 characters.";
    if (!Number.isFinite(amt) || amt <= 0) errs.amount = "Enter an amount above zero.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) errs.due = "Pick the next due date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const id = `manual-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
    onAdd({
      id,
      merchant: id,
      displayName: name.trim(),
      category,
      kind,
      billType,
      amount: amt,
      typicalAmount: billType === "variable" ? amt : undefined,
      currency,
      frequency,
      intervalDays: DAYS[frequency],
      lastCharge: today,
      nextRenewal: due,
      firstSeen: today,
      chargeCount: 0,
      totalSpent: 0,
      history: [],
      confidence: 1,
      confidenceReasons: ["Added by you"],
      status: "confirmed",
      international: currency !== home,
      manual: true,
    });
  }

  const err = (k: string) => errors[k] && <span className="mt-1 block text-[12px] text-alert">{errors[k]}</span>;
  return (
    <form onSubmit={submit} noValidate className="border border-ink bg-paper px-4 py-5 sm:px-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="display text-[24px]">Add a bill</h2>
        <button type="button" className="text-[13px] text-muted link" onClick={onCancel}>Cancel</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[12px] text-muted sm:col-span-2">Name<input className="field mt-1 text-ink" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House rent, Spectranet" />{err("name")}</label>
        <label className="text-[12px] text-muted">Type
          <select className="field mt-1 text-ink" value={kind} onChange={(e) => { const k = e.target.value as ObligationKind; setKind(k); setCategory(CATEGORIES[k][0]); }}>
            {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-muted">Category
          <select className="field mt-1 text-ink" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES[kind].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-muted">Amount<input className="field mt-1 text-ink num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />{err("amount")}</label>
        <label className="text-[12px] text-muted">Currency
          <select className="field mt-1 text-ink" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="NGN">NGN</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="text-[12px] text-muted">How often
          <select className="field mt-1 text-ink" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-muted">Next due<input type="date" className="field mt-1 text-ink" value={due} onChange={(e) => setDue(e.target.value)} />{err("due")}</label>
        <fieldset className="text-[12px] text-muted sm:col-span-2">
          <legend>Amount is</legend>
          <div className="mt-1 flex gap-px">
            {(["fixed", "variable"] as BillType[]).map((b) => (
              <button type="button" key={b} onClick={() => setBillType(b)} className={`h-10 flex-1 border text-[13px] ${billType === b ? "border-ink bg-ink text-paper" : "rule text-muted"}`}>{b === "fixed" ? "The same each time" : "Varies (usage-based)"}</button>
            ))}
          </div>
        </fieldset>
        <div className="flex items-end sm:col-span-2"><button className="btn btn-primary w-full sm:w-auto">Add bill</button></div>
      </div>
    </form>
  );
}
