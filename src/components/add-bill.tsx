"use client";
import { useState } from "react";
import { GROUP_LABEL, groupPatch, type Group } from "@/lib/review";
import type { BillType, Frequency, Subscription } from "@/lib/types";

const DAYS: Record<Frequency, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };

/** Manually add a bill that isn't in the statement (e.g. rent paid in cash, a new plan). */
export function AddBill({ home, onAdd, onCancel }: { home: string; onAdd(s: Subscription): void; onCancel(): void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<Group>("subscriptions");
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) errs.due = "Pick the date it's next due.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const id = `manual-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
    onAdd({
      id,
      merchant: id,
      displayName: name.trim(),
      ...groupPatch({ kind: "subscription", category: "Other" } as Subscription, group),
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
    <form onSubmit={submit} noValidate className="panel px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Add a regular payment</h2>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px] text-muted sm:col-span-2">Name<input className="input mt-1 text-ink" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House rent" />{err("name")}</label>
        <label className="text-[12.5px] text-muted">Category
          <select className="input mt-1 text-ink" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            {(Object.keys(GROUP_LABEL) as Group[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-muted">How often
          <select className="input mt-1 text-ink" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="quarterly">Every three months</option>
            <option value="yearly">Every year</option>
          </select>
        </label>
        <label className="text-[12.5px] text-muted">Amount ({currency})<input className="input mt-1 text-ink num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />{err("amount")}</label>
        <label className="text-[12.5px] text-muted">Next due<input type="date" className="input mt-1 text-ink" value={due} onChange={(e) => setDue(e.target.value)} />{err("due")}</label>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={billType === "variable"} onChange={(e) => setBillType(e.target.checked ? "variable" : "fixed")} />
          The amount changes each time (like electricity)
        </label>
        {currency === home && home === "NGN" && <button type="button" className="text-left text-[12px] text-muted underline sm:col-span-2" onClick={() => setCurrency("USD")}>Paid in US dollars?</button>}
        <div className="sm:col-span-2"><button className="btn btn-primary w-full sm:w-auto">Add payment</button></div>
      </div>
    </form>
  );
}
