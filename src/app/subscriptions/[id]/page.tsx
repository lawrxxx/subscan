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
import { Confidence, StatusTag } from "@/components/bits";

export default function SubscriptionDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, updateSubscription, removeSubscription } = useStore();
  const router = useRouter();
  const s = state.subscriptions.find((x) => x.id === decodeURIComponent(id));
  const [editing, setEditing] = useState(false);

  if (!ready) return null;
  if (!s) return <Missing what="subscription" back="/subscriptions" backLabel="All subscriptions" />;

  const max = Math.max(...s.history.map((h) => h.amount));
  const min = Math.min(...s.history.map((h) => h.amount));
  const barH = (a: number) => (max === min ? 55 : 30 + (70 * (a - min)) / (max - min));
  const dUntil = daysUntil(s.nextRenewal);

  return (
    <div>
      <div className="border-b rule px-4 py-4 text-[13px] sm:px-8 lg:px-12">
        <Link href="/subscriptions" className="text-muted link">Subscriptions</Link> <span className="text-faint">/</span> {s.displayName}
      </div>

      <section className="grid border-b rule lg:grid-cols-[1.3fr_1fr]">
        <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusTag status={s.status} />
            <span className="tag">{KIND_LABEL[s.kind ?? "subscription"]}</span>
            <span className="tag">{s.category}</span>
            {s.billType === "variable" && <span className="tag">Varies</span>}
            {s.manual && <span className="tag">Added by you</span>}
            {s.international && <span className="tag">Billed in {s.currency}</span>}
          </div>
          <h1 className="display text-[44px] sm:text-[64px]">{s.displayName}</h1>
          <div className="mt-8 grid grid-cols-2 border-t rule sm:grid-cols-4">
            {[
              ["Amount", `${money(s.amount, s.currency)}`],
              ["Cadence", FREQ_LABEL[s.frequency]],
              ["Next renewal", `${date(s.nextRenewal)}`],
              ["Spent so far", money(s.totalSpent, s.currency)],
            ].map(([k, v]) => (
              <div key={k} className="border-b rule py-4 pr-4">
                <div className="text-[12px] text-muted">{k}</div>
                <div className="num mt-1 text-[18px]">{v}</div>
              </div>
            ))}
          </div>
          {s.missed && !s.lapsed && (
            <p className="mt-4 border-l-2 border-alert bg-alert-wash/50 px-3 py-2 text-[13px] text-ink-2">
              A payment was expected around {date(s.missed.expected)} but isn&rsquo;t in your statement. It may be overdue, paid another way, or cancelled — check with the provider.
            </p>
          )}
          {s.unusual && (
            <p className="mt-4 border-l-2 border-amber bg-amber-wash/50 px-3 py-2 text-[13px] text-ink-2">
              The latest charge ({money(s.unusual.amount, s.currency)} on {date(s.unusual.date)}) is well above the usual {money(s.unusual.typical, s.currency)}.
            </p>
          )}
          {s.lapsed && (
            <p className="mt-4 border-l-2 border-amber bg-amber-wash/50 px-3 py-2 text-[13px] text-ink-2">
              No charge since {date(s.lastCharge)} — this looks cancelled, so it&rsquo;s left out of your totals and renewals. Dismiss it if you&rsquo;ve stopped paying.
            </p>
          )}
          {!s.lapsed && (
            <p className="mt-4 text-[13px] text-muted">
              Renews {relDays(dUntil)} (estimated from a ~{s.intervalDays}-day billing interval). About {money(monthlyEquivalent(s) * 12, s.currency)} a year at the current price.
            </p>
          )}

          <div className="mt-10 flex flex-wrap gap-3">
            {s.status !== "confirmed" && <button className="btn btn-primary" onClick={() => updateSubscription(s.id, { status: "confirmed" })}>Confirm subscription</button>}
            <Link href={`/pay/${encodeURIComponent(s.id)}`} className={s.status === "confirmed" ? "btn btn-primary" : "btn btn-ghost"}>Prepare payment</Link>
            <button className="btn btn-ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close editor" : "Edit details"}</button>
            {s.status !== "dismissed" ? (
              s.manual ? (
              <button className="btn btn-ghost text-alert" onClick={() => { removeSubscription(s.id); router.push("/subscriptions"); }}>Delete bill</button>
            ) : (
              <button className="btn btn-ghost text-alert" onClick={() => { updateSubscription(s.id, { status: "dismissed" }); router.push("/subscriptions"); }}>Not a recurring bill</button>
            )
            ) : (
              <button className="btn btn-ghost" onClick={() => updateSubscription(s.id, { status: "detected" })}>Restore</button>
            )}
          </div>
          {editing && <Editor s={s} onSave={(p) => { updateSubscription(s.id, { ...p, edited: true }); setEditing(false); }} />}
        </div>

        <div className="px-4 py-10 sm:px-8 lg:px-10">
          <div className="kicker mb-4">Charge history</div>
          <div className="flex h-[140px] items-end gap-[5px] border-b border-ink pb-px" role="img" aria-label="Charge amounts over time">
            {s.history.map((h, i) => {
              const changed = i > 0 && h.amount !== s.history[i - 1].amount;
              return (
                <div key={h.date} className="group relative max-w-[28px] flex-1" style={{ height: `${barH(h.amount)}%` }}>
                  <div className={`h-full ${changed ? "bg-alert" : "bg-ink/70"} group-hover:bg-accent`} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap bg-ink px-1.5 py-0.5 text-[11px] text-paper group-hover:block">
                    {date(h.date, "day")} · {money(h.amount, s.currency)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted num"><span>{date(s.firstSeen)}</span><span>{max === min ? `Flat at ${money(max, s.currency)}` : `${money(min, s.currency)} – ${money(max, s.currency)}`}</span><span>{date(s.lastCharge)}</span></div>
          {s.priceChange && (
            <p className="mt-3 text-[13px]">
              <span className={s.priceChange.pct > 0 ? "text-alert" : "text-accent"}>{s.priceChange.pct > 0 ? "Price rose" : "Price fell"} {Math.abs(Math.round(s.priceChange.pct * 100))}%</span>{" "}
              <span className="text-muted">from {money(s.priceChange.from, s.currency)} to {money(s.priceChange.to, s.currency)} on {date(s.priceChange.date)}.</span>
            </p>
          )}

          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <div className="kicker">Why we think this recurs</div>
              <Confidence value={s.confidence} />
            </div>
            <ul className="space-y-1.5 text-[13px] text-ink-2">{s.confidenceReasons.map((r) => <li key={r} className="border-l-2 border-rule pl-3">{r}</li>)}</ul>
          </div>
        </div>
      </section>

      <PaymentMethod s={s} onSave={(payment) => updateSubscription(s.id, { payment })} />

      <section className="px-4 py-10 sm:px-8 lg:px-12">
        <h2 className="display mb-4 text-[24px]">Transactions</h2>
        <ul className="max-w-2xl border-t border-ink">
          {[...s.history].reverse().map((h) => (
            <li key={h.date} className="flex justify-between border-b rule py-2.5 text-[14px]">
              <span className="num">{date(h.date)}</span>
              <span className="num">{money(h.amount, s.currency)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
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
      className="mt-8 grid max-w-xl gap-4 border-t rule pt-6 sm:grid-cols-2"
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
      <label className="text-[12px] text-muted sm:col-span-2">Name<input className="field mt-1 text-ink" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label className="text-[12px] text-muted">Type
        <select className="field mt-1 text-ink" value={kind} onChange={(e) => { const k = e.target.value as ObligationKind; setKind(k); setCategory(CATEGORIES[k][0]); }}>
          {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">Category
        <select className="field mt-1 text-ink" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">{billType === "variable" ? "Typical amount" : "Amount"} ({s.currency})<input className="field mt-1 text-ink num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="text-[12px] text-muted">Amount is
        <select className="field mt-1 text-ink" value={billType} onChange={(e) => setBillType(e.target.value as BillType)}>
          <option value="fixed">The same each time</option>
          <option value="variable">Varies (usage-based)</option>
        </select>
      </label>
      <label className="text-[12px] text-muted">How often
        <select className="field mt-1 text-ink" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">Next due<input type="date" className="field mt-1 text-ink" value={next} onChange={(e) => setNext(e.target.value)} /></label>
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
    <section id="settlement" className="grid scroll-mt-16 border-b rule lg:grid-cols-[1fr_1.3fr]">
      <div className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12">
        <div className="kicker mb-3">Merchant settlement</div>
        <h2 className="display text-[30px]">How this merchant gets paid on Celo</h2>
        <p className="mt-3 max-w-md text-[14px] text-muted">
          subscan never guesses where money goes. Add the merchant&rsquo;s own Celo receiving address, or an x402 payment endpoint they publish. Most card-billed services
          do not accept stablecoins yet — only add details the merchant has given you.
        </p>
        {s.payment && (
          <div className="mt-6 border-l-2 border-accent pl-4 text-[13px]">
            <div className="font-medium">{s.payment.method === "x402" ? "x402 endpoint" : "Direct transfer"} · {TOKENS[s.payment.token].display}</div>
            {s.payment.address && <a href={addressUrl(s.payment.address)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link break-all">{s.payment.address}</a>}
            {s.payment.x402Url && <div className="font-mono text-[12px] break-all text-muted">{s.payment.x402Url}</div>}
            {s.payment.note && <div className="mt-1 text-muted">{s.payment.note}</div>}
            <button className="mt-2 text-[12px] text-alert link" onClick={() => { onSave(undefined); setCheck(null); }}>Remove</button>
          </div>
        )}
      </div>
      <div className="px-4 py-10 sm:px-8 lg:px-12">
        <div className="mb-5 flex gap-px text-[13px]">
          {(["address", "x402"] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={`border-b-2 px-3 py-1.5 ${method === m ? "border-ink" : "border-transparent text-muted"}`}>
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
                <select className="field mt-1 text-ink" value={token} onChange={(e) => setToken(e.target.value as PaymentTarget["token"])}>
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
