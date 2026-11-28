"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { Icon, PageBar, PayStatus } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { addressUrl, TOKENS, txUrl } from "@/lib/celo/config";
import { autopilotAvailable, createAutopilotWallet, fund, grant, passkeysSupported, quoteGrant, revoke, status, updateRecipients, type AutopilotStatus } from "@/lib/autopilot/browser";
import { useStore } from "@/lib/db/store";
import { date, money, shortHash } from "@/lib/format";
import { tokenBalance } from "@/lib/payments/execute";
import type { AutopilotRecipient } from "@/lib/types";
import { runAutopilotFor } from "@/lib/autopilot/runner";

const fmt = (atomic: string | bigint, t: "USDT" | "cNGN") => Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function Autopilot() {
  const store = useStore();
  const { state, ready, setAutopilot, updateSubscription, logAction } = store;
  const ap = state.autopilot;
  const w = useWallet();
  const [avail, setAvail] = useState<{ available: boolean; conversions: boolean } | null>(null);
  const [st, setSt] = useState<AutopilotStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const [bal, setBal] = useState<{ USDT: bigint; cNGN: bigint } | null>(null);

  useEffect(() => void autopilotAvailable().then(setAvail), []);

  const refresh = useCallback(async () => {
    if (!ap?.wallet) return;
    const [u, n] = await Promise.all([tokenBalance("USDT", ap.wallet).catch(() => 0n), tokenBalance("cNGN", ap.wallet).catch(() => 0n)]);
    setBal({ USDT: u, cNGN: n });
    if (ap.sealedPolicy && !ap.revokedAt) setSt(await status(ap.sealedPolicy, ap.wallet).catch(() => null));
  }, [ap?.wallet, ap?.sealedPolicy, ap?.revokedAt]);
  useEffect(() => void refresh(), [refresh]);

  // Bills that can be paid automatically: a verified Celo address the user added themselves.
  const payable = useMemo(() => state.subscriptions.filter((s) => s.status !== "dismissed" && s.payment?.method === "address" && s.payment.address), [state.subscriptions]);
  const agentPayments = state.payments.filter((p) => p.via === "autopilot");
  const active = !!ap?.sealedPolicy && !ap.revokedAt && (ap.expiry ?? 0) * 1000 > Date.now();

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr(undefined);
    setNote(undefined);
    try {
      await fn();
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/settings" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />settings</Link></div>
      <PageBar title="Autopilot" sub="Let subscan pay the bills you choose, within limits you set." />
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        {avail && !avail.available && <p className="rounded-[12px] bg-amber-wash px-3 py-2.5 text-[13.5px] text-amber">Autopilot isn&rsquo;t switched on for this site yet.</p>}
        {err && <p className="rounded-[12px] bg-alert-wash px-3 py-2.5 text-[13.5px] text-alert" role="alert">{err}</p>}
        {note && <p className="rounded-[12px] bg-accent-wash px-3 py-2.5 text-[13.5px] text-accent" role="status">{note}</p>}

        {!active && (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">What Autopilot can and can&rsquo;t do</h2>
            <div className="mt-2 grid gap-3 text-[13.5px] sm:grid-cols-2">
              <ul className="space-y-1">
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Pay bills you switch on, when they&rsquo;re due</li>
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Only to recipients you approve</li>
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Up to your monthly limit</li>
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Convert dollars to naira first if a bill needs it</li>
              </ul>
              <ul className="space-y-1 text-ink-2">
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Spend over your limit: your wallet itself blocks it</li>
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Touch money outside your Autopilot wallet</li>
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Keep access after it expires or you revoke it</li>
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Pay anything without a record you can check</li>
              </ul>
            </div>
          </section>
        )}

        {/* Step 1: wallet */}
        {!ap?.wallet ? (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">1. Create your Autopilot wallet</h2>
            <p className="mt-1 text-[13.5px] text-muted">A separate wallet only you control, unlocked with Face ID or your fingerprint. subscan can never take money out of it beyond what you allow.</p>
            {!passkeysSupported() && <p className="mt-2 text-[13px] text-alert">This browser can&rsquo;t create passkeys. Try Chrome, Safari or your phone&rsquo;s browser.</p>}
            <button className="btn btn-primary mt-3 w-full sm:w-auto" disabled={!!busy || !passkeysSupported() || avail?.available === false} onClick={() => run("create", async () => { const { address, passkey } = await createAutopilotWallet(); setAutopilot({ wallet: address, passkey, enabled: false, limits: { USDT: "20", cNGN: "30000" }, recipients: [] }); })}>
              {busy === "create" ? "Waiting for your passkey…" : "Create Autopilot wallet"}
            </button>
          </section>
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Your Autopilot wallet</h2>
              <a href={addressUrl(ap.wallet)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{shortHash(ap.wallet, 4)}</a>
            </div>
            <dl className="grid grid-cols-2 text-[13.5px] [&>div]:px-4 [&>div]:py-3">
              <div className="border-r rule"><dt className="text-muted">Dollars (USD₮)</dt><dd className="figure mt-0.5 text-[20px]">{bal ? fmt(bal.USDT, "USDT") : "—"}</dd></div>
              <div><dt className="text-muted">Naira (cNGN)</dt><dd className="figure mt-0.5 text-[20px]">{bal ? fmt(bal.cNGN, "cNGN") : "—"}</dd></div>
            </dl>
            <Fund wallet={ap.wallet} from={w.address} connect={w.connect} gasUsdt={state.settings.payGasInUsdt} onDone={(h) => { setNote(`Money added. Transaction ${shortHash(h, 4)}.`); void refresh(); }} />
          </section>
        )}

        {/* Step 2: permissions */}
        {ap?.wallet && !active && (
          <Grant
            wallet={ap.wallet}
            passkey={ap.passkey}
            payable={payable.map((s) => ({ id: s.id, name: s.displayName, address: s.payment!.address!, token: s.payment!.token }))}
            initial={ap}
            busy={busy === "grant"}
            disabled={!!busy || avail?.available === false}
            onGrant={(limits, days, recipients) =>
              run("grant", async () => {
                const g = await grant({ wallet: ap.wallet, passkey: ap.passkey, limits, days, recipients });
                setAutopilot({ ...g, limits, recipients, enabled: true, grantedAt: new Date().toISOString(), revokedAt: undefined, revokeTx: undefined, sealedKey: undefined });
                logAction({ kind: "confirmed", title: "Gave subscan payment access", detail: `Up to ${limits.USDT} USD₮ and ${limits.cNGN} cNGN a month, ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}, ${days} days` });
                setNote("Autopilot is on. subscan can now pay your chosen bills within these limits.");
              })
            }
          />
        )}

        {/* Active */}
        {active && ap && (
          <>
            <div className={`callout ${ap.enabled ? "callout-sage" : "callout-amber"} justify-start`} role="status">
              <span className="tile bg-surface"><Icon name={ap.enabled ? "check" : "clock"} size={17} /></span>
              <span className="min-w-0"><span className="block font-semibold">{ap.enabled ? "autopilot is active" : "autopilot is paused"}</span><span className="block text-[12.5px] text-ink-2">{ap.enabled ? "Payments run only within your rules." : "Nothing is paid until you switch it back on."}</span></span>
            </div>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Automatic payments</h2>
                <label className="flex items-center gap-2 text-[13.5px]">
                  <button role="switch" aria-checked={ap.enabled} aria-label="Automatic payments" onClick={() => setAutopilot({ enabled: !ap.enabled })} className={`relative h-7 w-12 rounded-full transition-colors ${ap.enabled ? "bg-accent" : "bg-line-strong"}`}>
                    <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-surface shadow-sm transition-all ${ap.enabled ? "left-[23px]" : "left-[3px]"}`} />
                  </button>
                  {ap.enabled ? "On" : "Paused"}
                </label>
              </div>
              <dl className="divide-y divide-[var(--color-rule-soft)] text-[13.5px]">
                <Row k="Payment limit">{ap.limits.USDT} USD₮ and {Number(ap.limits.cNGN).toLocaleString("en-US")} cNGN a month</Row>
                <Row k="Left this month">{st ? `${fmt(st.remaining.USDT, "USDT")} USD₮ · ${fmt(st.remaining.cNGN, "cNGN")} cNGN` : "Checking…"}</Row>
                <Row k="Access expires">{ap.expiry ? date(new Date(ap.expiry * 1000).toISOString().slice(0, 10)) : "—"}</Row>
                <Row k="Checked on Celo">{st ? (st.authorized ? <span className="text-accent">Access is active</span> : <span className="text-alert">Not authorised</span>) : "Checking…"}</Row>
                {ap.grantTx && <Row k="Permission record"><a className="link font-mono text-[12px]" href={txUrl(ap.grantTx)} target="_blank" rel="noreferrer">{shortHash(ap.grantTx, 4)}</a></Row>}
              </dl>
            </section>

            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">Bills Autopilot pays</h2></div>
              {!payable.length ? (
                <p className="px-4 py-3 text-[13px] text-muted">None yet. Open a bill and add the provider&rsquo;s wallet address under &ldquo;Pay from a digital wallet&rdquo;.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-rule-soft)]">
                  {payable.map((s) => {
                    const approved = ap.recipients.some((r) => r.address.toLowerCase() === s.payment!.address!.toLowerCase());
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{s.displayName}</span>
                          <span className="block text-[12px] text-muted">{money(s.amount, s.currency)} · {approved ? `to ${shortHash(s.payment!.address!, 4)}` : "recipient not approved"}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {approved ? (
                            <>
                              <button className="btn btn-ghost btn-sm" disabled={!!busy || !ap.enabled} onClick={() => run(`pay-${s.id}`, async () => { const r = await runAutopilotFor(store, s.id, { force: true }); setNote(r); })}>{busy === `pay-${s.id}` ? "Paying…" : "Pay now"}</button>
                              <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" className="accent-[var(--color-accent)]" checked={!!s.autopay} onChange={(e) => updateSubscription(s.id, { autopay: e.target.checked })} />Auto</label>
                            </>
                          ) : (
                            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run("rec", async () => { const recipients = [...ap.recipients, { address: s.payment!.address!, label: s.displayName, billId: s.id }]; const { sealedPolicy } = await updateRecipients(ap.sealedPolicy!, ap.wallet, recipients); setAutopilot({ sealedPolicy, recipients }); })}>Approve recipient</button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="border-t rule px-4 py-2 text-[12px] text-muted">Your monthly limit and the list of allowed actions are enforced by your wallet on Celo. The approved-recipient list is checked by subscan before every payment.</p>
            </section>
          </>
        )}

        {agentPayments.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Recent Autopilot payments</h2></div>
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {agentPayments.slice(0, 10).map((p) => (
                <li key={p.id} className="px-4 py-2.5 text-[13.5px]">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/wallet/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.merchant} · <span className="num">{p.destinationAmount} {TOKENS[p.destinationToken].display}</span></Link>
                    <PayStatus status={p.status} />
                  </div>
                  <div className="text-[12px] text-muted">{new Date(p.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{p.refusals?.length ? ` · ${p.refusals[0]}` : ""}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {ap?.sealedPolicy && !ap.revokedAt && (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">Revoke access</h2>
            <p className="mt-1 text-[13px] text-muted">Stops subscan from making any more payments, straight away. Your money stays in your Autopilot wallet.</p>
            <button className="btn btn-danger mt-3" disabled={!!busy} onClick={() => run("revoke", async () => { const tx = await revoke(ap.wallet, ap.agentPublicKey!, ap.passkey); setAutopilot({ revokedAt: new Date().toISOString(), revokeTx: tx, enabled: false }); logAction({ kind: "dismissed", title: "Revoked subscan's payment access", detail: tx ? `Transaction ${shortHash(tx, 4)}` : undefined }); setNote("Access revoked. subscan can no longer make payments from your Autopilot wallet."); })}>
              {busy === "revoke" ? "Waiting for your passkey…" : "Revoke subscan's access"}
            </button>
          </section>
        )}
        {ap?.revokedAt && <p className="text-[13px] text-muted">Access revoked on {date(ap.revokedAt.slice(0, 10))}{ap.revokeTx ? <> · <a className="link" href={txUrl(ap.revokeTx)} target="_blank" rel="noreferrer">record</a></> : null}. You can give access again with new limits.</p>}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right">{children}</dd></div>;
}

function Fund({ wallet, from, connect, gasUsdt, onDone }: { wallet: `0x${string}`; from?: `0x${string}`; connect(): Promise<void>; gasUsdt: boolean; onDone(h: string): void }) {
  const [token, setToken] = useState<"USDT" | "cNGN">("USDT");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <div className="border-t rule px-4 py-3">
      <div className="text-[13.5px] font-medium">Add money</div>
      <p className="text-[12.5px] text-muted">From the wallet you already use (MiniPay, MetaMask). Keep a little USD₮ for the small network fee.</p>
      {!from ? (
        <button className="btn btn-ghost mt-2" onClick={() => void connect()}>Connect your wallet</button>
      ) : (
        <form className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(undefined); try { onDone(await fund(from, wallet, token, amount, gasUsdt)); setAmount(""); } catch (x) { setErr((x as { shortMessage?: string }).shortMessage ?? (x as Error).message); } finally { setBusy(false); } }}>
          <div className="seg"><button type="button" aria-pressed={token === "USDT"} onClick={() => setToken("USDT")}>USD₮</button><button type="button" aria-pressed={token === "cNGN"} onClick={() => setToken("cNGN")}>cNGN</button></div>
          <input className="input num" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to add" />
          <button className="btn btn-primary" disabled={busy || !(Number(amount) > 0)}>{busy ? "Confirm in your wallet…" : "Add money"}</button>
        </form>
      )}
      {err && <p className="mt-1 text-[12.5px] text-alert">{err}</p>}
    </div>
  );
}

function Grant({ wallet, passkey, payable, initial, busy, disabled, onGrant }: { wallet: `0x${string}`; passkey?: { kind: "webauthn"; id: string; publicKey: `0x${string}`; rpId?: string }; payable: { id: string; name: string; address: `0x${string}`; token: "USDT" | "cNGN" }[]; initial: { limits: { USDT: string; cNGN: string }; recipients: AutopilotRecipient[] }; busy: boolean; disabled: boolean; onGrant(limits: { USDT: string; cNGN: string }, days: number, recipients: AutopilotRecipient[]): void }) {
  const [usdt, setUsdt] = useState(initial.limits.USDT);
  const [cngn, setCngn] = useState(initial.limits.cNGN);
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState<string[]>(initial.recipients.map((r) => r.billId ?? "").filter(Boolean));
  const recipients = payable.filter((p) => picked.includes(p.id)).map((p) => ({ address: p.address, label: p.name, billId: p.id }));
  const [cost, setCost] = useState<{ registrationCelo: number; celoBalance: number } | null | "error">(null);
  useEffect(() => {
    quoteGrant({ wallet, passkey, limits: { USDT: usdt || "0", cNGN: cngn || "0" }, days }).then((q) => setCost(q), () => setCost("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, passkey]);
  return (
    <section className="panel px-4 py-4">
      <h2 className="text-[15px] font-semibold">2. Choose what subscan may do</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px] text-muted">Monthly limit in dollars (USD₮)<input className="input num mt-1" inputMode="decimal" value={usdt} onChange={(e) => setUsdt(e.target.value)} /></label>
        <label className="text-[12.5px] text-muted">Monthly limit in naira (cNGN)<input className="input num mt-1" inputMode="decimal" value={cngn} onChange={(e) => setCngn(e.target.value)} /></label>
        <label className="text-[12.5px] text-muted sm:col-span-2">Access lasts
          <select className="input mt-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] text-muted">Approved recipients</legend>
        {!payable.length ? (
          <p className="mt-1 text-[13px] text-muted">No bills have a verified wallet address yet. You can approve recipients later.</p>
        ) : (
          <ul className="mt-1 divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
            {payable.map((p) => (
              <li key={p.id}>
                <label className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                  <span className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--color-accent)]" checked={picked.includes(p.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />{p.name}</span>
                  <span className="font-mono text-[12px] text-muted">{shortHash(p.address, 4)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {cost && cost !== "error" && cost.registrationCelo > 0 && (
        <p className={`mt-3 rounded-[12px] px-3 py-2 text-[12.5px] ${cost.celoBalance < cost.registrationCelo ? "bg-amber-wash text-amber" : "bg-paper-2 text-ink-2"}`}>
          A new wallet&rsquo;s first action costs about {cost.registrationCelo.toLocaleString("en-US", { maximumFractionDigits: 2 })} CELO once, to register it on Celo, plus a small network fee. Later changes only cost the network fee. {cost.celoBalance < cost.registrationCelo ? `Your Autopilot wallet has ${cost.celoBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} CELO.` : ""}
        </p>
      )}
      <p className="mt-3 rounded-[12px] bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
        You&rsquo;ll confirm with your passkey. Your wallet will only let subscan move dollars and naira, or convert them through Textile FX, up to these limits until the access expires. You can revoke it at any time.
      </p>
      <button className="btn btn-primary mt-3 w-full sm:w-auto" disabled={disabled || !(Number(usdt) >= 0) || !(Number(cngn) >= 0)} onClick={() => onGrant({ USDT: String(Number(usdt) || 0), cNGN: String(Number(cngn) || 0) }, days, recipients)}>
        {busy ? "Waiting for your passkey…" : "Give subscan access"}
      </button>
    </section>
  );
}
