"use client";
import { useState } from "react";
import { editPatch, GROUP_LABEL, groupOf, type Group } from "@/lib/review";
import type { Frequency, Subscription } from "@/lib/types";

/** Edit a regular payment's name, category, amount and frequency. Single column on phones. */
export function EditPayment({ s, initialName, submitLabel = "Save changes", onCancel, onSave }: { s: Subscription; initialName: string; submitLabel?: string; onCancel(): void; onSave(p: Partial<Subscription>, name: string): void }) {
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<Group>(groupOf(s));
  const [amount, setAmount] = useState(String(s.amount));
  const [frequency, setFrequency] = useState<Frequency>(s.frequency);
  const [err, setErr] = useState<string>();
  return (
    <form
      className="mt-3 grid gap-3 rounded-[12px] border rule bg-surface p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const amt = Number(amount.replace(/[,\s]/g, ""));
        if (!name.trim()) return setErr("Give this payment a name you'll recognise.");
        if (!Number.isFinite(amt) || amt <= 0) return setErr("Enter an amount above zero.");
        onSave(editPatch(s, { name, group, amount: amt, frequency }), name.trim());
      }}
    >
      <label className="text-[12.5px] text-muted sm:col-span-2">
        Name
        <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Netflix, House rent" autoFocus />
      </label>
      <label className="text-[12.5px] text-muted">
        Category
        <select className="input mt-1" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
          {(Object.keys(GROUP_LABEL) as Group[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </select>
      </label>
      <label className="text-[12.5px] text-muted">
        How often
        <select className="input mt-1" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
          <option value="quarterly">Every three months</option>
          <option value="yearly">Every year</option>
        </select>
      </label>
      <label className="text-[12.5px] text-muted sm:col-span-2">
        Usual amount ({s.currency})
        <input className="input num mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {err && <p className="text-[12.5px] text-alert sm:col-span-2" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
