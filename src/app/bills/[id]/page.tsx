"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { addressUrl, TOKENS, tokenForCurrency } from "@/lib/celo/config";
import { publicClient } from "@/lib/celo/wallet";
import { monthlyEquivalent } from "@/lib/detection/analysis";
import { addPeriod } from "@/lib/detection/engine";
import { useStore } from "@/lib/db/store";
import { Missing } from "@/components/empty";
import { date, daysUntil, FREQ_LABEL, money, relDays } from "@/lib/format";
import type { BillType, Frequency, ObligationKind, PaymentTarget, Subscription } from "@/lib/types";
import { CATEGORIES, KIND_LABEL } from "@/lib/detection/merchants";
import { Avatar, BillStatus, RecurrenceText, Icon, PayStatus, Stat } from "@/components/ui";

export default function BillDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, updateSubscription, removeSubscription, logAction } = useStore();
  const router = useRouter();
  const s = state.subscriptions.find((x) => x.id === decodeURIComponent(id));
  const [editing, setEditing] = useState(false);

  if (!ready) return null;
  if (!s) return <Missing what="bill" back="/bills" backLabel="All bills" />;

  const max = Math.max(...s.history.map((h) => h.amount));
  const min = Math.min(...s.history.map((h) => h.amount));
  const barH = (a: number) => (max === min ? 55 : 30 + (70 * (a - min)) / (max - min));
  const dUntil = daysUntil(s.nextRenewal);
  const payments = state.payments.filter((p) => p.subscriptionId === s.id);
  const txs = state.transactions.filter((t) => t.merchant === s.merchant && (t.direction ?? "debit") === "debit").sort((a, b) => b.date.localeCompare(a.date));
  const setStatus = (status: Subscription["status"]) => {
    updateSubscription(s.id, { status });
    logAction({ kind: status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "restored", title: `${status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Dismissed" : "Restored"} ${s.displayName}`, href: `/bills/${encodeURIComponent(s.id)}` });
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-4 text-[13px]">
        <Link href="/bills" className="text-muted link">Bills</Link> <span className="text-faint">/</span> {s.displayName}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={s.displayName} size={44} />
          <div className="min-w-0">
            <h1 className="title truncate text-[26px] sm:text-[30px]">{s.displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <BillStatus s={s} />
              <span className="tag">{KIND_LABEL[s.kind ?? "subscription"]}</span>
              <span className="tag">{s.category}</span>
              {s.billType === "variable" && <span className="tag">Varies</span>}
              {s.manual && <span className="tag">Added by you</span>}
              {s.international && <span className="tag">Billed in {s.currency}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.status === "detected" && <button className="btn btn-ghost" onClick={() => setStatus("confirmed")}>Confirm</button>}
          <Link href={`/agent?q=${encodeURIComponent(`Tell me about ${s.displayName}: is it worth keeping and when is it next due?`)}`} className="btn btn-ghost">Ask agent</Link>
          <button className="btn btn-ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close editor" : "Edit"}</button>
          <Link href={`/pay/${encodeURIComponent(s.id)}`} className="btn btn-primary">Pay this bill</Link>
        </div>
      </div>

      {editing && (
        <section className="panel mt-4">
          <div className="panel-head"><h2 className="panel-title">Correct this bill</h2></div>
          <Editor s={s} onSave={(p) => { updateSubscription(s.id, { ...p, edited: true }); logAction({ kind: "recategorised", title: `Edited ${p.displayName ?? s.displayName}`, href: `/bills/${encodeURIComponent(s.id)}` }); setEditing(false); }} />
        </section>
      )}

      <section className="panel mt-4 grid grid-cols-2 divide-[var(--color-rule)] lg:grid-cols-4 lg:divide-x">
        <Stat label={s.billType === "variable" ? "Typical amount" : "Amount"} value={`${s.billType === "variable" ? "≈ " : ""}${money(s.amount, s.currency)}`} sub={FREQ_LABEL[s.frequency]} />
        <Stat label="Next due" value={s.lapsed ? "—" : date(s.nextRenewal)} sub={s.lapsed ? "Looks cancelled" : s.missed ? <span className="text-alert">Expected payment missing</span> : `Estimated · ${relDays(dUntil)}`} />
        <Stat label="Per year" value={money(monthlyEquivalent(s) * 12, s.currency)} sub="At the current price" />
        <Stat label="Paid so far" value={money(s.totalSpent, s.currency)} sub={`${s.chargeCount} charges since ${date(s.firstSeen)}`} />
      </section>

      {(s.missed && !s.lapsed) || s.unusual || s.lapsed ? (
        <div className="mt-4 space-y-2">
          {s.missed && !s.lapsed && <Notice tone="alert">A payment was expected around {date(s.missed.expected)} but isn&rsquo;t in your statement. It may be overdue, paid another way, or cancelled. Check with the provider.</Notice>}
          {s.unusual && <Notice tone="amber">The latest charge ({money(s.unusual.amount, s.currency)} on {date(s.unusual.date)}) is well above the usual {money(s.unusual.typical, s.currency)}.</Notice>}
          {s.lapsed && <Notice tone="amber">No charge since {date(s.lastCharge)}. This looks cancelled, so it&rsquo;s left out of your totals. Dismiss it if you&rsquo;ve stopped paying.</Notice>}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Charge history</h2>
              <span className="text-[12px] text-muted num">{max === min ? `Flat at ${money(max, s.currency)}` : `${money(min, s.currency)} – ${money(max, s.currency)}`}</span>
            </div>
            <div className="px-4 pt-6 pb-3 sm:px-5">
              <div className="flex h-[120px] items-end gap-[5px] border-b rule pb-px" role="img" aria-label="Charge amounts over time">
                {s.history.map((h, i) => {
                  const changed = i > 0 && h.amount !== s.history[i - 1].amount;
                  return (
                    <div key={h.date} className="group relative max-w-[28px] flex-1" style={{ height: `${barH(h.amount)}%` }}>
                      <div className={`h-full rounded-t-[2px] ${changed ? "bg-alert/80" : "bg-accent/70"} group-hover:bg-accent`} />
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-ink px-1.5 py-0.5 text-[11px] text-surface group-hover:block">
                        {date(h.date, "day")} · {money(h.amount, s.currency)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted num"><span>{date(s.firstSeen)}</span><span>{date(s.lastCharge)}</span></div>
              {s.priceChange && (
                <p className="mt-3 text-[13px]">
                  <span className={s.priceChange.pct > 0 ? "text-alert" : "text-accent"}>{s.priceChange.pct > 0 ? "Price rose" : "Price fell"} {Math.abs(Math.round(s.priceChange.pct * 100))}%</span>{" "}
                  <span className="text-muted">from {money(s.priceChange.from, s.currency)} to {money(s.priceChange.to, s.currency)} on {date(s.priceChange.date)}.</span>
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Statement transactions</h2><span className="count">{txs.length || s.history.length}</span></div>
            <div className="max-h-[360px] overflow-y-auto">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th></tr></thead>
                <tbody>
                  {txs.length
                    ? txs.map((t) => (
                        <tr key={t.id}><td className="num whitespace-nowrap text-muted">{date(t.date)}</td><td className="max-w-[260px] truncate text-ink-2">{t.description}</td><td className="r num">{money(t.amount, t.currency)}</td></tr>
                      ))
                    : [...s.history].reverse().map((h) => (
                        <tr key={h.date}><td className="num text-muted">{date(h.date)}</td><td className="text-muted">{s.manual ? "Added by you" : "Charge"}</td><td className="r num">{money(h.amount, s.currency)}</td></tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Why we think this recurs</h2>{!s.manual && <RecurrenceText s={s} />}</div>
            <ul className="space-y-1.5 px-4 py-4 text-[13px] text-ink-2 sm:px-5">{(s.manual ? ["You added this bill yourself."] : s.confidenceReasons).map((r) => <li key={r} className="flex gap-2"><Icon name="check" size={14} className="mt-0.5 shrink-0 text-faint" />{r}</li>)}</ul>
            {!s.lapsed && <p className="border-t rule px-4 py-3 text-[12px] text-muted sm:px-5">Next date estimated from a ~{s.intervalDays}-day billing interval.</p>}
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Payments through subscan</h2><span className="count">{payments.length}</span></div>
            {!payments.length ? (
              <p className="px-4 py-4 text-[13px] text-muted sm:px-5">None yet. Add how this payee gets paid, then pay from your Celo wallet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-rule)]">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                    <Link href={p.status === "prepared" ? `/pay/${encodeURIComponent(s.id)}` : `/activity/${p.id}`} className="hover:underline">{date(p.createdAt.slice(0, 10))} · <span className="num">{p.destinationAmount} {TOKENS[p.destinationToken].display}</span></Link>
                    <PayStatus status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel px-4 py-4 sm:px-5">
            <div className="text-[13px] font-medium">{s.status === "dismissed" ? "Dismissed" : s.manual ? "Remove this bill" : "Not a recurring bill?"}</div>
            <p className="mt-0.5 text-[12px] text-muted">{s.status === "dismissed" ? "It’s hidden from your totals." : s.manual ? "Deletes it from this device." : "Dismiss it and it won’t count towards your totals. You can restore it later."}</p>
            <div className="mt-3">
              {s.status !== "dismissed" ? (
                s.manual ? (
                  <button className="btn btn-danger btn-sm" onClick={() => { removeSubscription(s.id); router.push("/bills"); }}>Delete bill</button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setStatus("dismissed"); router.push("/bills"); }}>Dismiss</button>
                )
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setStatus("detected")}>Restore</button>
              )}
            </div>
          </section>
        </div>
      </div>

      <PaymentMethod s={s} onSave={(payment) => updateSubscription(s.id, { payment })} />
    </div>
  );
}

function Notice({ tone, children }: { tone: "alert" | "amber"; children: React.ReactNode }) {
  return <p className={`flex gap-2 rounded-[6px] px-3 py-2.5 text-[13px] ${tone === "alert" ? "bg-alert-wash text-alert" : "bg-amber-wash text-amber"}`}><Icon name="alert" size={16} className="mt-px shrink-0" /><span className="text-ink-2">{children}</span></p>;
}

function Editor({ s, onSave }: { s: Subscription; onSave(p: Partial<Subscription>): void }) {
  const [name, setName] = useState(s.displayName);
  const [kind, setKind] = useState<ObligationKind>(s.kind ?? "subscription");
  const [category, setCategory] = useState(s.category);
  const [billType, setBillType] = useState<BillType>(s.billType ?? "fixed");
  const [amount, setAmount] = useState(String(s.amount));
  const [frequency, setFrequency] = useState<Frequency>(s.frequency);
  const [next, setNext] = useState(s.nextRenewal);
  const [err, setErr] = useState<string>();
  const cats = CATEGORIES[kind].includes(category) ? CATEGORIES[kind] : [category, ...CATEGORIES[kind]];
  return (
    <form
      className="grid max-w-2xl gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        const amt = Number(amount.replace(/,/g, ""));
        if (!name.trim()) return setErr("Name can’t be empty.");
        if (!Number.isFinite(amt) || amt <= 0) return setErr("Enter an amount above zero.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return setErr("Pick a valid next due date.");
        setErr(undefined);
        const days = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 }[frequency];
        onSave({ displayName: name.trim().slice(0, 80), kind, category, billType, amount: amt, typicalAmount: billType === "variable" ? amt : undefined, frequency, intervalDays: days, nextRenewal: next || addPeriod(s.lastCharge, frequency, days), missed: undefined });
      }}
    >
      <label className="text-[12px] text-muted sm:col-span-2">Name<input className="input mt-1 text-ink" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label className="text-[12px] text-muted">Type
        <select className="input mt-1 text-ink" value={kind} onChange={(e) => { const k = e.target.value as ObligationKind; setKind(k); setCategory(CATEGORIES[k][0]); }}>
          {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">Category
        <select className="input mt-1 text-ink" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">{billType === "variable" ? "Typical amount" : "Amount"} ({s.currency})<input className="input mt-1 text-ink num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="text-[12px] text-muted">Amount is
        <select className="input mt-1 text-ink" value={billType} onChange={(e) => setBillType(e.target.value as BillType)}>
          <option value="fixed">The same each time</option>
          <option value="variable">Varies (usage-based)</option>
        </select>
      </label>
      <label className="text-[12px] text-muted">How often
        <select className="input mt-1 text-ink" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">Next due<input type="date" className="input mt-1 text-ink" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      {err && <p className="text-[12px] text-alert sm:col-span-2">{err}</p>}
      <div className="flex items-end"><button className="btn btn-primary">Save changes</button></div>
    </form>
  );
}

function PaymentMethod({ s, onSave }: { s: Subscription; onSave(p: PaymentTarget | undefined): void }) {
  const defaultToken = s.payment?.token ?? tokenForCurrency(s.currency) ?? "USDT";
  const [method, setMethod] = useState<PaymentTarget["method"]>(s.payment?.method ?? "address");
  const [token, setToken] = useState<PaymentTarget["token"]>(defaultToken);
  const [address, setAddress] = useState(s.payment?.address ?? "");
  const [url, setUrl] = useState(s.payment?.x402Url ?? "");
  const [check, setCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setCheck(null);
    try {
      if (method === "address") {
        if (!isAddress(address, { strict: false })) throw new Error("Not a valid EVM address.");
        const a = getAddress(address);
        const code = await publicClient.getCode({ address: a });
        const kind = code && code !== "0x" ? "a smart contract" : "an externally owned account (EOA)";
        onSave({ method, token, address: a, verifiedAt: new Date().toISOString(), note: `On Celo mainnet this address is ${kind}.` });
        setAddress(a);
        setCheck({ ok: true, msg: `Saved. ${a.slice(0, 8)}… is ${kind} on Celo mainnet. Confirm with the merchant that it accepts ${TOKENS[token].display}.` });
      } else {
        const r = await fetch("/api/merchant/x402", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.json());
        if (r.error) throw new Error(r.error);
        if (!r.data.x402) throw new Error(`Endpoint answered HTTP ${r.data.status}, not 402 Payment Required.`);
        const celo = r.data.celoAccepts as { asset: string; amount: string; payTo: string }[];
        if (!celo.length) throw new Error("Endpoint speaks x402 but offers no Celo mainnet (eip155:42220) payment option.");
        const match = celo.find((a) => a.asset.toLowerCase() === TOKENS[token].address.toLowerCase()) ?? celo.find((a) => [TOKENS.USDT.address, TOKENS.cNGN.address].map((x) => x.toLowerCase()).includes(a.asset.toLowerCase()));
        if (!match) throw new Error("Endpoint's Celo options use a token subscan does not support yet (USD₮ or cNGN required).");
        const tok = match.asset.toLowerCase() === TOKENS.cNGN.address.toLowerCase() ? "cNGN" : "USDT";
        setToken(tok);
        onSave({ method, token: tok, x402Url: url, address: match.payTo as `0x${string}`, verifiedAt: new Date().toISOString(), note: `x402 on Celo: ${match.amount} atomic ${tok} to ${match.payTo}` });
        setCheck({ ok: true, msg: `Verified x402 endpoint. It asks for ${Number(match.amount) / 1e6} ${TOKENS[tok].display} paid to ${match.payTo.slice(0, 10)}…` });
      }
    } catch (e) {
      setCheck({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="settlement" className="panel mt-4 grid scroll-mt-16 lg:grid-cols-[1fr_1.3fr]">
      <div className="border-b rule px-4 py-5 sm:px-5 lg:border-r lg:border-b-0">
        <div className="label mb-2">Recipient details</div>
        <h2 className="text-[16px] font-semibold">How this payee gets paid on Celo</h2>
        <p className="mt-2 max-w-md text-[13px] text-muted">
          subscan never guesses where money goes. Add the merchant&rsquo;s own Celo receiving address, or an x402 payment endpoint they publish. Most card-billed services
          do not accept stablecoins yet — only add details the merchant has given you.
        </p>
        {s.payment && (
          <div className="mt-4 rounded-[6px] bg-accent-wash px-3 py-2.5 text-[13px]">
            <div className="font-medium">{s.payment.method === "x402" ? "x402 endpoint" : "Direct transfer"} · {TOKENS[s.payment.token].display}</div>
            {s.payment.address && <a href={addressUrl(s.payment.address)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link break-all">{s.payment.address}</a>}
            {s.payment.x402Url && <div className="font-mono text-[12px] break-all text-muted">{s.payment.x402Url}</div>}
            {s.payment.note && <div className="mt-1 text-muted">{s.payment.note}</div>}
            <button className="mt-2 text-[12px] text-alert link" onClick={() => { onSave(undefined); setCheck(null); }}>Remove</button>
          </div>
        )}
      </div>
      <div className="px-4 py-5 sm:px-5">
        <div className="seg mb-4" role="group" aria-label="Settlement method">
          {(["address", "x402"] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} aria-pressed={method === m}>
              {m === "address" ? "Receiving address" : "x402 endpoint"}
            </button>
          ))}
        </div>
        <div className="grid max-w-xl gap-4">
          {method === "address" ? (
            <>
              <label className="text-[12px] text-muted">Merchant&rsquo;s Celo address
                <input className="field mt-1 font-mono text-ink" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value.trim())} />
              </label>
              <label className="text-[12px] text-muted">Token the merchant accepts
                <select className="input mt-1 text-ink" value={token} onChange={(e) => setToken(e.target.value as PaymentTarget["token"])}>
                  <option value="cNGN">cNGN (naira)</option>
                  <option value="USDT">USD₮ (dollar)</option>
                </select>
              </label>
            </>
          ) : (
            <label className="text-[12px] text-muted">x402 resource URL (https)
              <input className="field mt-1 font-mono text-ink" placeholder="https://merchant.example/pay/plan" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
            </label>
          )}
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy || (method === "address" ? !address : !url)} onClick={verify}>{busy ? "Checking…" : method === "address" ? "Check & save address" : "Probe endpoint"}</button>
          </div>
          {check && <p className={`text-[13px] ${check.ok ? "text-accent" : "text-alert"}`}>{check.msg}</p>}
        </div>
      </div>
    </section>
  );
}
