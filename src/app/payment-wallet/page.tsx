"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { Icon, PageBar } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { addressUrl, TOKENS, txUrl } from "@/lib/celo/config";
import { publicClient } from "@/lib/celo/wallet";
import { autopilotAvailable, createAutopilotWallet, fund, grant, passkeysSupported, quoteGrant, revoke, status, type AutopilotStatus } from "@/lib/autopilot/browser";
import { TEMPLATE_VERSION } from "@/lib/autopilot/permissions";
import { useStore } from "@/lib/db/store";
import { date, shortHash } from "@/lib/format";
import { desiredPolicy, syncPolicy } from "@/lib/money/policy";

const fmt = (atomic: string | bigint, t: "USDT" | "cNGN") => Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const tokenBalance = (t: "USDT" | "cNGN", owner: `0x${string}`) => publicClient.readContract({ address: TOKENS[t].address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

export default function PaymentWallet() {
  const store = useStore();
  const { state, ready, setAutopilot } = store;
  const ap = state.autopilot;
  const w = useWallet();
  const [avail, setAvail] = useState<{ available: boolean; conversions: boolean } | null>(null);
  const [st, setSt] = useState<AutopilotStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const [bal, setBal] = useState<{ USDT: bigint; cNGN: bigint } | null>(null);
  const [capEdit, setCapEdit] = useState<{ USDT: string; cNGN: string } | null>(null);

  useEffect(() => void autopilotAvailable().then(setAvail), []);

  const refresh = useCallback(async () => {
    if (!ap?.wallet) return;
    const [u, n] = await Promise.all([tokenBalance("USDT", ap.wallet).catch(() => 0n), tokenBalance("cNGN", ap.wallet).catch(() => 0n)]);
    setBal({ USDT: u, cNGN: n });
    if (ap.sealedPolicy && !ap.revokedAt) setSt(await status(ap.sealedPolicy, ap.wallet).catch(() => null));
  }, [ap?.wallet, ap?.sealedPolicy, ap?.revokedAt]);
  useEffect(() => void refresh(), [refresh]);

  const active = !!ap?.sealedPolicy && !ap.revokedAt && (ap.expiry ?? 0) * 1000 > Date.now();
  const outdated = active && (st?.templateVersion ?? ap?.templateVersion ?? 1) < TEMPLATE_VERSION;

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
    <div className="mx-auto max-w-3xl lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/settings" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />settings</Link></div>
      <PageBar title="payment wallet" sub="The wallet your money rules and transfers run from. Only you control it." />
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        {avail && !avail.available && <p className="callout callout-amber block text-[13.5px]">Automatic payments aren&rsquo;t switched on for this site yet.</p>}
        {err && <p className="callout callout-red block text-[13.5px]" role="alert">{err}</p>}
        {note && <p className="callout callout-sage block text-[13.5px]" role="status">{note}</p>}

        {!active && (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">What subscan can and can&rsquo;t do</h2>
            <div className="mt-2 grid gap-3 text-[13.5px] sm:grid-cols-2">
              <ul className="space-y-1">
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Convert between US dollars and naira when a money rule says so</li>
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Send scheduled transfers to people you&rsquo;ve saved and confirmed</li>
                <li className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0 text-positive" />Up to your monthly limit and your cap per transfer</li>
              </ul>
              <ul className="space-y-1 text-ink-2">
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Spend over your monthly limit: your wallet itself blocks it</li>
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Send to anyone you haven&rsquo;t saved</li>
                <li className="flex gap-2"><Icon name="close" size={16} className="mt-0.5 shrink-0 text-alert" />Keep access after it expires or you revoke it</li>
              </ul>
            </div>
          </section>
        )}

        {!ap?.wallet ? (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">1. Create your payment wallet</h2>
            <p className="mt-1 text-[13.5px] text-muted">Unlocked with Face ID or your fingerprint on this device. subscan can never take money out of it beyond what you allow.</p>
            {!passkeysSupported() && <p className="mt-2 text-[13px] text-alert">This browser can&rsquo;t create passkeys. Try Chrome, Safari or your phone&rsquo;s browser.</p>}
            <button className="btn btn-primary mt-3 w-full sm:w-auto" disabled={!!busy || !passkeysSupported() || avail?.available === false} onClick={() => run("create", async () => { const { address, passkey } = await createAutopilotWallet(); setAutopilot({ wallet: address, passkey, enabled: false, limits: { USDT: "20", cNGN: "30000" }, maxPerTransfer: { USDT: "20", cNGN: "10000" } }); })}>
              {busy === "create" ? "Waiting for your passkey…" : "Create payment wallet"}
            </button>
          </section>
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">My money</h2>
              <a href={addressUrl(ap.wallet)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">{shortHash(ap.wallet, 4)}</a>
            </div>
            <dl className="grid grid-cols-2 text-[13.5px] [&>div]:px-4 [&>div]:py-3">
              <div className="border-r rule"><dt className="text-muted">US dollars (USD₮)</dt><dd className="figure mt-0.5 text-[20px]">{bal ? fmt(bal.USDT, "USDT") : "—"}</dd></div>
              <div><dt className="text-muted">Naira (cNGN)</dt><dd className="figure mt-0.5 text-[20px]">{bal ? fmt(bal.cNGN, "cNGN") : "—"}</dd></div>
            </dl>
            <Fund wallet={ap.wallet} from={w.address} connect={w.connect} gasUsdt={state.settings.payGasInUsdt} onDone={(h) => { setNote(`Money added. Transaction ${shortHash(h, 4)}.`); void refresh(); }} />
          </section>
        )}

        {ap?.wallet && (!active || outdated) && (
          <>
            {outdated && <p className="callout callout-amber block text-[13.5px]">Your current access was granted by an earlier version and can&rsquo;t convert naira back to dollars. Give access again below to update it. Your old access is replaced.</p>}
            <Grant
              wallet={ap.wallet}
              passkey={ap.passkey}
              initial={ap}
              recipients={state.recipients.filter((r) => r.confirmedAt).length}
              busy={busy === "grant"}
              disabled={!!busy || avail?.available === false}
              onGrant={(limits, maxPerTransfer, days) =>
                run("grant", async () => {
                  const desired = desiredPolicy({ ...state, autopilot: { ...ap, maxPerTransfer } });
                  const g = await grant({ wallet: ap.wallet, passkey: ap.passkey, limits, maxPerTransfer: desired.maxPerTransfer, days, recipients: desired.recipients });
                  setAutopilot({ ...g, limits, maxPerTransfer, enabled: true, grantedAt: new Date().toISOString(), revokedAt: undefined, revokeTx: undefined, templateVersion: TEMPLATE_VERSION });
                  setNote("Done. subscan can now run your money rules and transfers within these limits.");
                })
              }
            />
          </>
        )}

        {active && ap && (
          <>
            <div className={`callout ${ap.enabled ? "callout-sage" : "callout-amber"} justify-start`} role="status">
              <span className="tile bg-surface"><Icon name={ap.enabled ? "check" : "clock"} size={17} /></span>
              <span className="min-w-0"><span className="block font-semibold">{ap.enabled ? "automation is on" : "automation is paused"}</span><span className="block text-[12.5px] text-ink-2">{ap.enabled ? "Rules and transfers run while subscan is open, within your limits." : "Nothing runs automatically until you switch it back on."}</span></span>
            </div>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Automation</h2>
                <label className="flex items-center gap-2 text-[13.5px]">
                  <button role="switch" aria-checked={ap.enabled} aria-label="Automation" onClick={() => setAutopilot({ enabled: !ap.enabled })} className={`relative h-7 w-12 rounded-full transition-colors ${ap.enabled ? "bg-accent" : "bg-line-strong"}`}>
                    <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-surface shadow-sm transition-all ${ap.enabled ? "left-[23px]" : "left-[3px]"}`} />
                  </button>
                  {ap.enabled ? "On" : "Paused"}
                </label>
              </div>
              <dl className="rows text-[13.5px]">
                <Row k="Monthly limit">{ap.limits.USDT} USD₮ · {Number(ap.limits.cNGN).toLocaleString("en-US")} cNGN</Row>
                <Row k="Left this month">{st ? `${fmt(st.remaining.USDT, "USDT")} USD₮ · ${fmt(st.remaining.cNGN, "cNGN")} cNGN` : "Checking…"}</Row>
                <Row k="Most per transfer">
                  {capEdit ? (
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <input className="input num h-9 w-24" value={capEdit.USDT} onChange={(e) => setCapEdit({ ...capEdit, USDT: e.target.value })} aria-label="USD₮ cap" /> USD₮
                      <input className="input num h-9 w-28" value={capEdit.cNGN} onChange={(e) => setCapEdit({ ...capEdit, cNGN: e.target.value })} aria-label="cNGN cap" /> cNGN
                      <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run("cap", async () => { setAutopilot({ maxPerTransfer: { USDT: String(Number(capEdit.USDT) || ""), cNGN: String(Number(capEdit.cNGN) || "") } }); await syncPolicy(store); setCapEdit(null); setNote("Cap updated. subscan's server checks it before every transfer."); })}>Save</button>
                    </span>
                  ) : (
                    <button className="link" onClick={() => setCapEdit({ USDT: ap.maxPerTransfer?.USDT ?? "", cNGN: ap.maxPerTransfer?.cNGN ?? "" })}>{ap.maxPerTransfer?.USDT || ap.maxPerTransfer?.cNGN ? `${ap.maxPerTransfer?.USDT ?? "—"} USD₮ · ${ap.maxPerTransfer?.cNGN ? Number(ap.maxPerTransfer.cNGN).toLocaleString("en-US") : "—"} cNGN` : "No cap"} · change</button>
                  )}
                </Row>
                <Row k="Saved recipients">{st ? `${st.recipients.length} approved on subscan's server` : "Checking…"}</Row>
                <Row k="Access ends">{ap.expiry ? date(new Date(ap.expiry * 1000).toISOString().slice(0, 10)) : "—"}</Row>
                <Row k="Checked on Celo">{st ? (st.authorized ? <span className="text-positive">Access is active</span> : <span className="text-alert">Not authorised</span>) : "Checking…"}</Row>
                {ap.grantTx && <Row k="Permission record"><a className="link font-mono text-[12px]" href={txUrl(ap.grantTx)} target="_blank" rel="noreferrer">{shortHash(ap.grantTx, 4)}</a></Row>}
              </dl>
              <p className="border-t rule px-4 py-2.5 text-[12px] text-muted">Your wallet on Celo enforces the monthly limit, which currencies can move and the end date. subscan&rsquo;s server checks your saved recipients and the per-transfer cap before it signs anything.</p>
            </section>
          </>
        )}

        {ap?.sealedPolicy && !ap.revokedAt && (
          <section className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">Revoke access</h2>
            <p className="mt-1 text-[13px] text-muted">Stops subscan from moving any money, straight away. Your money stays in your payment wallet.</p>
            <button className="btn btn-danger mt-3" disabled={!!busy} onClick={() => run("revoke", async () => { const tx = await revoke(ap.wallet, ap.agentPublicKey!, ap.passkey); setAutopilot({ revokedAt: new Date().toISOString(), revokeTx: tx, enabled: false }); setNote("Access revoked. subscan can no longer move money from your payment wallet."); })}>
              {busy === "revoke" ? "Waiting for your passkey…" : "Revoke subscan's access"}
            </button>
          </section>
        )}
        {ap?.revokedAt && <p className="px-1 text-[13px] text-muted">Access revoked on {date(ap.revokedAt.slice(0, 10))}{ap.revokeTx ? <> · <a className="link" href={txUrl(ap.revokeTx)} target="_blank" rel="noreferrer">record</a></> : null}. You can give access again with new limits.</p>}
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
      <p className="text-[12.5px] text-muted">From the wallet you already use (MiniPay, MetaMask). Keep a little USD₮ for network fees.</p>
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

function Grant({ wallet, passkey, initial, recipients, busy, disabled, onGrant }: { wallet: `0x${string}`; passkey?: { kind: "webauthn"; id: string; publicKey: `0x${string}`; rpId?: string }; initial: { limits: { USDT: string; cNGN: string }; maxPerTransfer?: { USDT?: string; cNGN?: string } }; recipients: number; busy: boolean; disabled: boolean; onGrant(limits: { USDT: string; cNGN: string }, maxPerTransfer: { USDT?: string; cNGN?: string }, days: number): void }) {
  const [usdt, setUsdt] = useState(initial.limits.USDT);
  const [cngn, setCngn] = useState(initial.limits.cNGN);
  const [capU, setCapU] = useState(initial.maxPerTransfer?.USDT ?? "");
  const [capN, setCapN] = useState(initial.maxPerTransfer?.cNGN ?? "");
  const [days, setDays] = useState(30);
  const [cost, setCost] = useState<{ registrationCelo: number; celoBalance: number } | null | "error">(null);
  useEffect(() => {
    quoteGrant({ wallet, passkey, limits: { USDT: usdt || "0", cNGN: cngn || "0" }, days }).then((q) => setCost(q), () => setCost("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, passkey]);
  return (
    <section className="panel px-4 py-4">
      <h2 className="text-[15px] font-semibold">2. Choose what subscan may do</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-[12.5px] text-muted">Monthly limit, US dollars (USD₮)<input className="input num mt-1" inputMode="decimal" value={usdt} onChange={(e) => setUsdt(e.target.value)} /></label>
        <label className="text-[12.5px] text-muted">Monthly limit, naira (cNGN)<input className="input num mt-1" inputMode="decimal" value={cngn} onChange={(e) => setCngn(e.target.value)} /></label>
        <label className="text-[12.5px] text-muted">Most per transfer, USD₮<input className="input num mt-1" inputMode="decimal" value={capU} onChange={(e) => setCapU(e.target.value)} placeholder="No cap" /></label>
        <label className="text-[12.5px] text-muted">Most per transfer, cNGN<input className="input num mt-1" inputMode="decimal" value={capN} onChange={(e) => setCapN(e.target.value)} placeholder="No cap" /></label>
        <label className="text-[12.5px] text-muted sm:col-span-2">Access lasts
          <select className="input mt-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-[12.5px] text-muted">{recipients ? `Your ${recipients} saved recipient${recipients === 1 ? "" : "s"} will be approved.` : "You can save recipients after this, in Transfers."} Network fees are paid in USD₮ and count towards the monthly limit.</p>
      {cost && cost !== "error" && cost.registrationCelo > 0 && (
        <p className={`mt-3 rounded-[12px] px-3 py-2 text-[12.5px] ${cost.celoBalance < cost.registrationCelo ? "bg-amber-wash text-amber" : "bg-paper-2 text-ink-2"}`}>
          A new wallet&rsquo;s first action costs about {cost.registrationCelo.toLocaleString("en-US", { maximumFractionDigits: 2 })} CELO once, to register it on Celo, plus a small network fee. Later changes only cost the network fee. {cost.celoBalance < cost.registrationCelo ? `Your payment wallet has ${cost.celoBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} CELO.` : ""}
        </p>
      )}
      <p className="mt-3 rounded-[12px] bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
        You&rsquo;ll confirm with your passkey. Your wallet will only let subscan move US dollars and naira, or convert them through Textile FX, up to these limits until the access ends. You can revoke it at any time.
      </p>
      <button className="btn btn-primary mt-3 w-full sm:w-auto" disabled={disabled || !(Number(usdt) >= 0) || !(Number(cngn) >= 0)} onClick={() => onGrant({ USDT: String(Number(usdt) || 0), cNGN: String(Number(cngn) || 0) }, { ...(Number(capU) > 0 ? { USDT: String(Number(capU)) } : {}), ...(Number(capN) > 0 ? { cNGN: String(Number(capN)) } : {}) }, days)}>
        {busy ? "Waiting for your passkey…" : "Give subscan access"}
      </button>
    </section>
  );
}
