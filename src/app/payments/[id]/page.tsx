"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { EditPayment } from "@/components/edit-payment";
import { Missing } from "@/components/empty";
import { Icon, PayStatus } from "@/components/ui";
import { addressUrl, TOKENS, tokenForCurrency } from "@/lib/celo/config";
import { publicClient } from "@/lib/celo/wallet";
import { monthlyEquivalent } from "@/lib/detection/analysis";
import { useStore } from "@/lib/db/store";
import { date, money } from "@/lib/format";
import { displayLabel, explain, frequencyText, GROUP_LABEL, groupOf, level, LEVEL_LABEL, predictedNext, rawDescription } from "@/lib/review";
import type { PaymentTarget, Subscription } from "@/lib/types";

export default function PaymentDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, updateSubscription, removeSubscription, logAction } = useStore();
  const router = useRouter();
  const s = state.subscriptions.find((x) => x.id === decodeURIComponent(id));
  const [editing, setEditing] = useState(false);
  const [allPast, setAllPast] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  if (!ready) return null;
  if (!s) return <Missing what="payment" back="/payments" backLabel="All payments" />;

  const raw = rawDescription(s, state.transactions);
  const label = displayLabel(s, raw);
  const fmt = (n: number) => money(n, s.currency);
  const freq = frequencyText(s);
  const next = predictedNext(s);
  const records = state.payments.filter((p) => p.subscriptionId === s.id);
  const past = state.transactions.filter((t) => t.merchant === s.merchant && (t.direction ?? "debit") === "debit").sort((a, b) => b.date.localeCompare(a.date));
  const pastRows = past.length ? past.map((t) => ({ key: t.id, date: t.date, amount: t.amount, desc: t.description })) : [...s.history].reverse().map((h) => ({ key: h.date, date: h.date, amount: h.amount, desc: "" }));
  const setStatus = (status: Subscription["status"]) => {
    updateSubscription(s.id, { status });
    logAction({ kind: status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "restored", title: `${status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Marked not regular:" : "Moved back to check:"} ${label.name}`, href: `/payments/${encodeURIComponent(s.id)}` });
  };
  const lv = level(s);

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:py-8">
      <Link href="/payments" className="text-[13px] text-muted hover:text-ink">← Payments</Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="title truncate text-[22px] sm:text-[24px]">{label.name}</h1>
          <p className="text-[13px] text-muted">{GROUP_LABEL[groupOf(s)]}{freq ? ` · ${freq.toLowerCase()}` : ""}</p>
          {label.detail && <p className="truncate text-[12px] text-faint" title={label.detail}>On your statement: {label.detail}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="figure text-[24px]">{s.billType === "variable" ? "≈ " : ""}{fmt(s.amount)}</div>
          <div className="text-[12px] text-muted">{s.billType === "variable" ? "usual amount" : "each time"}</div>
        </div>
      </div>

      {s.status === "detected" && !s.manual && (
        <div className="mt-4 rounded-[6px] border border-amber/30 bg-amber-wash px-3 py-3">
          <p className="text-[13.5px]"><span className="font-semibold">Not checked yet.</span> {LEVEL_LABEL[lv]}: {explain(s, fmt)}</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex">
            <button className="btn btn-primary" onClick={() => setStatus("confirmed")}>Yes, I pay this</button>
            <button className="btn btn-ghost" onClick={() => { setStatus("dismissed"); router.push("/payments"); }}>Not regular</button>
          </div>
        </div>
      )}
      {s.status === "dismissed" && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[6px] bg-paper-2 px-3 py-2.5 text-[13.5px]">
          <span>You said this isn&rsquo;t a regular payment.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setStatus("detected")}>Check again</button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {s.missed && !s.lapsed && <Notice tone="alert">We expected a payment around {date(s.missed.expected)}, but it isn&rsquo;t in your statement. It may be late, paid another way, or cancelled.</Notice>}
        {s.unusual && <Notice tone="amber">The last payment ({fmt(s.unusual.amount)} on {date(s.unusual.date)}) was a lot more than usual ({fmt(s.unusual.typical)}).</Notice>}
        {s.lapsed && <Notice tone="amber">Nothing since {date(s.lastCharge)}. It looks like this has stopped, so it isn&rsquo;t counted in your totals.</Notice>}
        {s.priceChange && s.priceChange.pct > 0 && <Notice tone="amber">The price went up {Math.round(s.priceChange.pct * 100)}%, from {fmt(s.priceChange.from)} to {fmt(s.priceChange.to)}, on {date(s.priceChange.date)}.</Notice>}
      </div>

      <dl className="panel mt-4 divide-y divide-[var(--color-rule-soft)] text-[14px]">
        <Fact k="Next payment">{s.lapsed ? "Looks stopped" : next ? date(next) : <span className="text-muted">We can&rsquo;t tell yet</span>}</Fact>
        <Fact k="How often">{freq ?? <span className="text-muted">Not sure yet</span>}</Fact>
        {freq && <Fact k="Each year">about {fmt(monthlyEquivalent(s) * 12)}</Fact>}
        {!s.manual && <Fact k="Paid so far">{fmt(s.totalSpent)} <span className="text-muted">({s.chargeCount} payments)</span></Fact>}
      </dl>

      {!s.manual && pastRows.length > 0 && (
        <section className="mt-5">
          <h2 className="text-[14px] font-semibold">Past payments</h2>
          <ul className="mt-2 divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
            {(allPast ? pastRows : pastRows.slice(0, 5)).map((r) => (
              <li key={r.key} className="flex justify-between gap-3 py-2 text-[13.5px]">
                <span className="num text-muted">{date(r.date)}</span>
                <span className="num">{fmt(r.amount)}</span>
              </li>
            ))}
          </ul>
          {pastRows.length > 5 && <button className="mt-1.5 text-[13px] text-muted hover:text-ink" onClick={() => setAllPast((v) => !v)}>{allPast ? "Show fewer" : `Show all ${pastRows.length}`}</button>}
          {s.status !== "detected" && <p className="mt-2 text-[12.5px] text-muted">{explain(s, fmt)}</p>}
        </section>
      )}

      {editing ? (
        <EditPayment s={s} initialName={label.unknown ? "" : label.name} onCancel={() => setEditing(false)} onSave={(p, name) => { updateSubscription(s.id, p); logAction({ kind: "recategorised", title: `Edited ${name}`, href: `/payments/${encodeURIComponent(s.id)}` }); setEditing(false); }} />
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex">
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit details</button>
          <Link href={`/ask?q=${encodeURIComponent(`Tell me about my ${label.name} payments. Is it worth keeping?`)}`} className="btn btn-ghost">Ask subscan</Link>
          {s.status === "confirmed" && !s.manual && <button className="btn btn-quiet col-span-2 sm:ml-auto" onClick={() => { setStatus("dismissed"); router.push("/payments"); }}>Not a regular payment</button>}
          {s.manual && <button className="btn btn-quiet col-span-2 text-alert sm:ml-auto" onClick={() => { removeSubscription(s.id); router.push("/payments"); }}>Delete this payment</button>}
        </div>
      )}

      <section className="mt-8 border-t rule pt-4">
        <button className="flex w-full items-center justify-between text-left" onClick={() => setWalletOpen((v) => !v)} aria-expanded={walletOpen || !!s.payment}>
          <span>
            <span className="block text-[14px] font-medium">Pay from a digital wallet</span>
            <span className="block text-[12.5px] text-muted">Optional. Only if {label.unknown ? "this provider" : label.name} accepts digital dollars or naira.</span>
          </span>
          <span className="text-[12.5px] text-muted">{walletOpen || s.payment ? "Hide" : "Set up"}</span>
        </button>
        {(walletOpen || s.payment) && (
          <div className="mt-3 space-y-3">
            <PaymentMethod s={s} onSave={(payment) => updateSubscription(s.id, { payment })} />
            {s.payment && <Link href={`/pay/${encodeURIComponent(s.id)}`} className="btn btn-primary w-full sm:w-auto">Review a payment</Link>}
            {records.length > 0 && (
              <ul className="divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
                {records.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <Link href={p.status === "prepared" ? `/pay/${encodeURIComponent(s.id)}` : `/wallet/${p.id}`} className="hover:underline">{date(p.createdAt.slice(0, 10))} · <span className="num">{p.destinationAmount} {TOKENS[p.destinationToken].display}</span></Link>
                    <PayStatus status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "alert" | "amber"; children: React.ReactNode }) {
  return <p className={`flex gap-2 rounded-[6px] px-3 py-2.5 text-[13px] ${tone === "alert" ? "bg-alert-wash text-alert" : "bg-amber-wash text-amber"}`}><Icon name="alert" size={16} className="mt-px shrink-0" /><span className="text-ink-2">{children}</span></p>;
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
    <section id="settlement" className="panel scroll-mt-16">
      <div className="border-b rule px-4 py-4">
        <p className="text-[13px] text-muted">
          Most providers don&rsquo;t accept this yet. Only add payment details the provider has given you: we never guess where money goes.
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
      <div className="px-4 py-4">
        <div className="seg mb-4" role="group" aria-label="Payment details type">
          {(["address", "x402"] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} aria-pressed={method === m}>
              {m === "address" ? "Wallet address" : "Payment link (x402)"}
            </button>
          ))}
        </div>
        <div className="grid max-w-xl gap-4">
          {method === "address" ? (
            <>
              <label className="text-[12px] text-muted">Provider’s Celo wallet address
                <input className="field mt-1 font-mono text-ink" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value.trim())} />
              </label>
              <label className="text-[12px] text-muted">They accept
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
            <button className="btn btn-primary" disabled={busy || (method === "address" ? !address : !url)} onClick={verify}>{busy ? "Checking…" : method === "address" ? "Check and save" : "Check link"}</button>
          </div>
          {check && <p className={`text-[13px] ${check.ok ? "text-accent" : "text-alert"}`}>{check.msg}</p>}
        </div>
      </div>
    </section>
  );
}
