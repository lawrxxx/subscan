"use client";
import { useState } from "react";
import { KIND_TEXT, other } from "@/lib/money/rules";
import type { MoneyRule, RuleKind, TokenSymbol } from "@/lib/types";
import { Icon } from "./ui";

const KINDS: { kind: RuleKind; icon: string }[] = [
  { kind: "keep_min", icon: "shield" },
  { kind: "convert_below", icon: "swap" },
  { kind: "reserve_share", icon: "coins" },
  { kind: "transfer_cap", icon: "lock" },
];
const NAME = (t: TokenSymbol) => (t === "USDT" ? "USD₮" : "cNGN");

function defaultName(kind: RuleKind, token: TokenSymbol, amount: string, pct: string) {
  if (kind === "keep_min") return `Keep ${Number(amount || 0).toLocaleString("en-US")} ${NAME(token)} ready`;
  if (kind === "convert_below") return `Top up ${NAME(token)} when low`;
  if (kind === "reserve_share") return `${pct || "?"}% in ${NAME(token)}`;
  return `${NAME(token)} transfer limit`;
}

export function RuleForm({ initial, onSave, onCancel }: { initial?: MoneyRule; onSave(r: MoneyRule): void; onCancel(): void }) {
  const [kind, setKind] = useState<RuleKind>(initial?.kind ?? "keep_min");
  const [token, setToken] = useState<TokenSymbol>(initial?.token ?? "cNGN");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [pct, setPct] = useState(initial?.sharePct ? String(initial.sharePct) : "");
  const [convertAmount, setConvertAmount] = useState(initial?.convertAmount ?? "");
  const [maxAmount, setMaxAmount] = useState(initial?.maxAmount ?? "");
  const [askFirst, setAskFirst] = useState(!!initial?.askFirst);
  // An auto-generated name follows the settings; a name the user typed is kept.
  const autoNamed = !initial || initial.name === defaultName(initial.kind, initial.token, initial.amount, initial.sharePct ? String(initial.sharePct) : "");
  const [name, setName] = useState(autoNamed ? "" : initial?.name ?? "");
  const [err, setErr] = useState<string>();
  const from = other(token);
  const converts = kind !== "transfer_cap";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pos = (v: string) => Number(v) > 0 && Number.isFinite(Number(v));
    if (kind !== "reserve_share" && !pos(amount)) return setErr(kind === "transfer_cap" ? "Enter the largest transfer you'll allow." : "Enter the balance to protect.");
    if (kind === "reserve_share" && !(Number(pct) >= 1 && Number(pct) <= 99)) return setErr("Enter a share between 1 and 99%.");
    if (kind === "convert_below" && !pos(convertAmount)) return setErr("Enter how much to convert each time.");
    if (maxAmount && !pos(maxAmount)) return setErr("The maximum must be a positive number.");
    const t = new Date().toISOString();
    onSave({
      id: initial?.id ?? `rule_${Date.now().toString(36)}`,
      name: name.trim() || defaultName(kind, token, amount, pct),
      kind,
      token,
      amount: kind === "reserve_share" ? "0" : String(Number(amount)),
      sharePct: kind === "reserve_share" ? Number(pct) : undefined,
      fromToken: converts ? from : undefined,
      convertAmount: kind === "convert_below" ? String(Number(convertAmount)) : undefined,
      maxAmount: converts && maxAmount ? String(Number(maxAmount)) : kind === "convert_below" ? String(Number(convertAmount)) : undefined,
      askFirst: converts ? askFirst : undefined,
      status: initial?.status ?? "active",
      createdAt: initial?.createdAt ?? t,
      updatedAt: t,
      lastCheckedAt: initial?.lastCheckedAt,
      lastRunAt: initial?.lastRunAt,
      lastOutcome: initial?.lastOutcome,
    });
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {!initial && (
        <fieldset>
          <legend className="section-title mb-2 px-1">what should this rule do?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button key={k.kind} type="button" onClick={() => setKind(k.kind)} aria-pressed={kind === k.kind} className={`flex items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left ${kind === k.kind ? "border-accent bg-sage/50" : "rule bg-surface hover:border-line-strong"}`}>
                <span className={`tile ${kind === k.kind ? "bg-surface" : ""}`}><Icon name={k.icon} size={17} /></span>
                <span className="min-w-0"><span className="block text-[14px] font-semibold">{KIND_TEXT[k.kind].title}</span><span className="block text-[12.5px] text-muted">&ldquo;{KIND_TEXT[k.kind].example}&rdquo;</span></span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <section className="panel space-y-4 px-4 py-4">
        <div>
          <div className="text-[12.5px] text-muted">{kind === "transfer_cap" ? "Currency" : kind === "reserve_share" ? "Keep a share in" : "Currency to protect"}</div>
          <div className="seg mt-1">
            {(["cNGN", "USDT"] as const).map((t) => <button key={t} type="button" aria-pressed={token === t} onClick={() => setToken(t)}>{t === "USDT" ? "US dollars (USD₮)" : "Naira (cNGN)"}</button>)}
          </div>
        </div>

        {kind === "keep_min" && (
          <>
            <Field label={`Keep at least (${NAME(token)})`} value={amount} onChange={setAmount} placeholder={token === "cNGN" ? "50000" : "50"} />
            <Field label={`Largest top-up at once (${NAME(from)}, optional)`} value={maxAmount} onChange={setMaxAmount} placeholder={from === "USDT" ? "20" : "30000"} hint={`When ${NAME(token)} drops below the amount, subscan converts ${NAME(from)} to top it back up.`} />
          </>
        )}
        {kind === "convert_below" && (
          <>
            <Field label={`When ${NAME(token)} falls below`} value={amount} onChange={setAmount} placeholder={token === "cNGN" ? "10000" : "10"} />
            <Field label={`Convert this much ${NAME(from)}`} value={convertAmount} onChange={setConvertAmount} placeholder={from === "USDT" ? "20" : "30000"} />
          </>
        )}
        {kind === "reserve_share" && (
          <>
            <Field label={`Keep at least this share in ${NAME(token)} (%)`} value={pct} onChange={setPct} placeholder="30" />
            <Field label={`Largest conversion at once (${NAME(from)}, optional)`} value={maxAmount} onChange={setMaxAmount} placeholder={from === "USDT" ? "20" : "30000"} hint="Shares are worked out with Textile FX's live rate. The conversion itself uses a firm quote." />
          </>
        )}
        {kind === "transfer_cap" && <Field label={`Never send more than (${NAME(token)}) in one automated transfer`} value={amount} onChange={setAmount} placeholder={token === "cNGN" ? "5000" : "20"} hint="Checked before every scheduled transfer, by this app and by subscan's server." />}

        {converts && (
          <label className="flex items-start gap-2.5 text-[13.5px]">
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={askFirst} onChange={(e) => setAskFirst(e.target.checked)} />
            <span>Ask me before converting<span className="block text-[12.5px] text-muted">You&rsquo;ll see the live rate and fee and approve each conversion.</span></span>
          </label>
        )}
        <Field label="Rule name (optional)" value={name} onChange={setName} placeholder={defaultName(kind, token, amount, pct)} text />
      </section>

      {converts && <p className="px-1 text-[12.5px] text-muted">Conversions go through Textile FX between US dollars and naira only, at its live firm quote. Its smallest conversion is about 1 USD₮ (≈1,450 cNGN). If no quote is available, nothing moves and the rule tells you why.</p>}
      {err && <p className="px-1 text-[13px] text-alert" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary">{initial ? "Save changes" : "Create rule"}</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, placeholder, hint, text }: { label: string; value: string; onChange(v: string): void; placeholder?: string; hint?: string; text?: boolean }) {
  return (
    <label className="block text-[12.5px] text-muted">
      {label}
      <input className={`input mt-1 ${text ? "" : "num"}`} inputMode={text ? "text" : "decimal"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <span className="mt-1 block text-[12px]">{hint}</span>}
    </label>
  );
}
