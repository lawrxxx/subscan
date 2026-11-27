"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { PaymentRequired } from "@x402/core/types";
import { addressUrl, TOKENS, type TokenSymbol } from "@/lib/celo/config";
import { waitForReceipt } from "@/lib/celo/wallet";
import { useStore } from "@/lib/db/store";
import { Missing } from "@/components/empty";
import { date, money } from "@/lib/format";
import { buildPaymentHeaders, describeRequirement, ensurePermit2Allowance } from "@/lib/merchant/x402-client";
import { approveIfNeeded, executeSwap, fetchPreview, requestFirmQuote, transferToMerchant } from "@/lib/payments/execute";
import { otherToken, planPayment } from "@/lib/payments/plan";
import { formatRate, type PreviewData } from "@/lib/textile/client";
import type { PaymentRecord, PaymentStep } from "@/lib/types";
import { HashLink, TxStatus } from "@/components/bits";
import { useWallet } from "@/components/wallet";

const fmt = (atomic: string | bigint, t: TokenSymbol, dp = t === "cNGN" ? 2 : 4) =>
  Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: dp });

export default function Pay() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, upsertPayment } = useStore();
  const w = useWallet();
  const sub = state.subscriptions.find((s) => s.id === decodeURIComponent(id));

  const dest = sub?.payment?.token ?? (sub ? planPayment(sub).destinationToken : undefined);
  const [picked, setSource] = useState<TokenSymbol>();
  const source = picked ?? (dest ? otherToken(dest) : undefined);
  const plan = useMemo(() => (sub ? planPayment(sub, { sourceToken: source }) : null), [sub, source]);

  // x402: the merchant's 402 response sets the amount and payee.
  const [x402, setX402] = useState<{ pr: PaymentRequired; req: ReturnType<typeof describeRequirement> } | null>(null);
  const [x402Err, setX402Err] = useState<string>();
  useEffect(() => {
    if (plan?.method !== "x402" || !plan.x402Url) return;
    fetch("/api/merchant/x402", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: plan.x402Url }) })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setX402Err(j.error);
        if (!j.data.x402 || !j.data.celoAccepts.length) return setX402Err("Endpoint no longer returns a Celo x402 payment requirement.");
        const req = describeRequirement(j.data.celoAccepts[0]);
        setX402({ pr: { ...j.data.paymentRequired, accepts: [j.data.celoAccepts[0]] }, req });
      })
      .catch((e) => setX402Err(String(e)));
  }, [plan?.method, plan?.x402Url]);

  const destAtomic = plan?.method === "x402" ? x402?.req.amount : plan?.destinationAtomic;
  const recipient = (plan?.method === "x402" ? x402?.req.payTo : plan?.recipient) as `0x${string}` | undefined;

  // Live indicative preview (refreshes every 20s, no commitment).
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewErr, setPreviewErr] = useState<string>();
  const loadPreview = useCallback(async () => {
    if (!plan?.needsConversion || !plan.sourceToken || !plan.destinationToken || !destAtomic) return;
    try {
      setPreview(await fetchPreview(plan.sourceToken, plan.destinationToken, destAtomic));
      setPreviewErr(undefined);
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : String(e));
    }
  }, [plan?.needsConversion, plan?.sourceToken, plan?.destinationToken, destAtomic]);
  useEffect(() => {
    setPreview(null);
    void loadPreview();
    const t = setInterval(loadPreview, 20_000);
    return () => clearInterval(t);
  }, [loadPreview]);

  const [agree, setAgree] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [record, setRecord] = useState<PaymentRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string>();

  if (!ready) return null;
  if (!sub || !plan) return <Missing what="subscription" back="/subscriptions" backLabel="All subscriptions" />;

  const srcTok = plan.sourceToken!;
  const dstTok = plan.destinationToken;
  const needSource = plan.needsConversion ? (preview?.takerPays ? BigInt(preview.takerPays) : null) : destAtomic ? BigInt(destAtomic) : null;
  const haveSource = w.balances ? w.balances.raw[srcTok] : null;
  const insufficient = needSource !== null && haveSource !== null && haveSource < needSource;
  const noLiquidity = plan.needsConversion && preview?.status === "no_quote";
  const blockers = [
    ...plan.problems,
    ...(x402Err ? [x402Err] : []),
    ...(!w.address ? ["Connect a Celo wallet to continue."] : []),
    ...(w.address && !w.onCelo ? ["Switch your wallet to Celo mainnet (42220)."] : []),
    ...(insufficient ? [`Not enough ${TOKENS[srcTok].display} in your wallet.`] : []),
    ...(noLiquidity ? [`Textile FX has no live ${TOKENS[srcTok].display}→${dstTok} liquidity for this size right now (${preview?.reason}).`] : []),
  ];
  const canRun = !blockers.length && agree && !running && !!destAtomic && !!recipient && (!plan.needsConversion || preview?.status === "preview");

  function saveDraft() {
    if (!destAtomic || !dstTok || !sub || !plan) return;
    upsertPayment({
      id: `pay_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      subscriptionId: sub.id,
      merchant: sub.displayName,
      sourceToken: srcTok,
      destinationToken: dstTok,
      sourceAmount: plan.needsConversion && preview?.takerPays ? fmt(preview.takerPays, srcTok) : fmt(destAtomic, dstTok),
      destinationAmount: fmt(destAtomic, dstTok),
      feeAmount: plan.needsConversion && preview?.feeAmount ? `${fmt(preview.feeAmount, srcTok)} ${TOKENS[srcTok].display} (indicative)` : undefined,
      rate: rate ? `${rate} (indicative)` : undefined,
      recipient,
      method: plan.method ?? "address",
      steps: [
        ...(plan.needsConversion
          ? [
              { kind: "approval" as const, label: "Allow Textile FX to spend source token", status: "prepared" as const },
              { kind: "conversion" as const, label: `Convert ${TOKENS[srcTok].display} → ${TOKENS[dstTok].display} via Textile FX`, status: "prepared" as const },
            ]
          : []),
        { kind: "settlement" as const, label: plan.method === "x402" ? "Pay merchant via x402" : `Transfer ${TOKENS[dstTok].display} to merchant`, status: "prepared" as const },
      ],
      status: "prepared",
      from: w.address,
    });
    setDraftSaved(true);
  }

  async function run() {
    if (!w.address || !destAtomic || !recipient || !dstTok) return;
    setRunning(true);
    setErr(undefined);
    const from = w.address;
    const gas = state.settings.payGasInUsdt;
    const steps: PaymentStep[] = [
      ...(plan!.needsConversion
        ? [
            { kind: "approval" as const, label: "Allow Textile FX to spend source token", status: "prepared" as const },
            { kind: "conversion" as const, label: `Convert ${TOKENS[srcTok].display} → ${TOKENS[dstTok].display} via Textile FX`, status: "prepared" as const },
          ]
        : []),
      { kind: "settlement", label: plan!.method === "x402" ? "Pay merchant via x402" : `Transfer ${TOKENS[dstTok].display} to merchant`, status: "prepared" },
    ];
    let rec: PaymentRecord = {
      id: `pay_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      subscriptionId: sub!.id,
      merchant: sub!.displayName,
      sourceToken: srcTok,
      destinationToken: dstTok,
      sourceAmount: plan!.needsConversion && preview?.takerPays ? fmt(preview.takerPays, srcTok) : fmt(destAtomic, dstTok),
      destinationAmount: fmt(destAtomic, dstTok),
      recipient,
      method: plan!.method ?? "address",
      steps,
      status: "pending",
      from,
    };
    const save = (patch: Partial<PaymentRecord>) => {
      rec = { ...rec, ...patch };
      setRecord(rec);
      upsertPayment(rec);
    };
    const step = (kind: PaymentStep["kind"], patch: Partial<PaymentStep>) =>
      save({ steps: rec.steps.map((s) => (s.kind === kind ? { ...s, ...patch, at: new Date().toISOString() } : s)) });
    save({});
    const cb = { onHash: (kind: PaymentStep["kind"], hash: `0x${string}`, label: string) => step(kind, { hash, label, status: "pending" }) };

    let current: PaymentStep["kind"] = steps[0].kind;
    try {
      if (plan!.needsConversion) {
        current = "approval";
        const quote = await requestFirmQuote(srcTok, dstTok, destAtomic, from);
        if (quote.status !== "quoted" || !quote.quote) throw new Error(`Textile FX returned no firm quote (${quote.reason ?? quote.status}). Nothing was sent.`);
        if (BigInt(quote.quote.buyAmount) < BigInt(destAtomic)) throw new Error("Firm quote delivers less than the merchant amount. Aborting.");
        save({
          rfqId: quote.rfqId,
          sourceAmount: fmt(quote.quote.takerPays, srcTok),
          feeAmount: `${fmt(quote.quote.feeAmount, srcTok)} ${TOKENS[srcTok].display}`,
          rate: formatRate(srcTok, dstTok, quote.quote.takerPays, quote.quote.buyAmount),
        });
        await approveIfNeeded(from, srcTok, quote, gas, cb);
        step("approval", { status: "confirmed", label: rec.steps.find((s) => s.kind === "approval")!.hash ? rec.steps.find((s) => s.kind === "approval")!.label : "Allowance already sufficient" });
        current = "conversion";
        await executeSwap(from, quote, gas, cb);
        step("conversion", { status: "confirmed" });
      }
      current = "settlement";
      if (plan!.method === "x402") {
        if (!x402) throw new Error("x402 requirement unavailable");
        const approveHash = await ensurePermit2Allowance(from, x402.pr.accepts[0], gas);
        if (approveHash) step("settlement", { label: "Permit2 allowance set; signing x402 payment", hash: approveHash, status: "pending" });
        const headers = await buildPaymentHeaders(from, x402.pr, BigInt(x402.req.amount));
        const r = await fetch("/api/merchant/x402", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: plan!.x402Url, mode: "pay", headers }) }).then((r) => r.json());
        if (r.error) throw new Error(r.error);
        const tx = r.data.settlement?.transaction as `0x${string}` | undefined;
        if (!r.data.ok || !tx) throw new Error(`Merchant did not confirm settlement (HTTP ${r.data.status}${r.data.settlement?.errorReason ? `: ${r.data.settlement.errorReason}` : ""}).`);
        step("settlement", { hash: tx, status: "pending", label: "x402 settlement submitted by facilitator" });
        const receipt = await waitForReceipt(tx);
        if (receipt.status !== "success") throw new Error("x402 settlement transaction reverted");
      } else {
        await transferToMerchant(from, dstTok, recipient, BigInt(destAtomic), gas, cb);
      }
      step("settlement", { status: "confirmed" });
      save({ status: "confirmed" });
      void w.refresh();
    } catch (e) {
      const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      step(current, { status: "failed", error: msg });
      save({ status: "failed" });
      setErr(msg);
    } finally {
      setRunning(false);
    }
  }

  const receive = plan.needsConversion && preview?.buyAmount ? preview.buyAmount : destAtomic;
  const rate = preview?.takerPays && preview.buyAmount && dstTok ? formatRate(srcTok, dstTok, preview.takerPays, preview.buyAmount) : null;

  return (
    <div>
      <div className="border-b rule px-4 py-4 text-[13px] sm:px-8 lg:px-12">
        <Link href="/subscriptions" className="text-muted link">Subscriptions</Link> <span className="text-faint">/</span>{" "}
        <Link href={`/subscriptions/${encodeURIComponent(sub.id)}`} className="text-muted link">{sub.displayName}</Link> <span className="text-faint">/</span> Payment
      </div>

      <div className="grid lg:grid-cols-[1fr_420px]">
        <section className="px-4 py-10 sm:px-8 lg:border-r lg:rule lg:px-12">
          <div className="kicker mb-3">Payment review · Celo mainnet</div>
          <h1 className="display text-[40px] sm:text-[56px]">Pay {sub.displayName}</h1>
          <p className="mt-2 text-[14px] text-muted">Renewal {date(sub.nextRenewal)} · {money(sub.amount, sub.currency)} {sub.frequency}</p>

          {/* Statement-style breakdown */}
          <div className="mt-10 max-w-2xl border-t-2 border-ink">
            <Row k="Merchant receives" v={destAtomic && dstTok ? `${fmt(destAtomic, dstTok)} ${TOKENS[dstTok].display}` : "—"} strong />
            <Row
              k="Paid to"
              v={recipient ? <a href={addressUrl(recipient)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link break-all">{recipient}</a> : <span className="text-alert">No verified recipient</span>}
              note={plan.method === "x402" ? "From the merchant's x402 payment requirement" : sub.payment?.note}
            />
            <Row k="Settlement method" v={plan.method === "x402" ? `x402 (${x402?.req.method === "permit2" ? "Permit2" : "EIP-3009"})` : plan.method === "address" ? "Direct token transfer" : "—"} />
            <div className="border-b rule py-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[14px] text-muted">Pay from</span>
                <div className="flex gap-px">
                  {(["USDT", "cNGN"] as TokenSymbol[]).map((t) => (
                    <button key={t} disabled={running || !!record} onClick={() => setSource(t)} className={`border px-3 py-1 text-[13px] ${source === t ? "border-ink bg-ink text-paper" : "rule text-muted"}`}>
                      {TOKENS[t].display}
                    </button>
                  ))}
                </div>
              </div>
              {w.balances && <div className="mt-1 text-right text-[12px] text-muted num">Wallet: {Number(w.balances[srcTok]).toLocaleString("en-US", { maximumFractionDigits: 4 })} {TOKENS[srcTok].display}</div>}
            </div>
            {plan.needsConversion ? (
              <>
                <Row k="Conversion" v={`${TOKENS[srcTok].display} → ${dstTok ? TOKENS[dstTok].display : ""} · Textile FX`} />
                <Row k="Exchange rate" v={rate ? rate : previewErr ? <span className="text-alert">{previewErr}</span> : "Fetching…"} note="Indicative. The firm rate is locked when you approve and holds ~60 seconds." />
                <Row k="Textile FX fee" v={preview?.feeAmount ? `${fmt(preview.feeAmount, srcTok)} ${TOKENS[srcTok].display}` : "—"} note="Protocol taker fee, included in the amount you pay" />
                <Row k="Converted amount received" v={receive && dstTok ? `${fmt(receive, dstTok)} ${TOKENS[dstTok].display}` : "—"} />
                <Row k="You pay" v={preview?.takerPays ? `${fmt(preview.takerPays, srcTok)} ${TOKENS[srcTok].display}` : "—"} strong />
              </>
            ) : (
              <Row k="You pay" v={destAtomic && dstTok ? `${fmt(destAtomic, dstTok)} ${TOKENS[dstTok].display}` : "—"} strong note="No conversion needed" />
            )}
            <Row k="Network fee" v={state.settings.payGasInUsdt ? "Paid in USD₮ (fee abstraction)" : "Paid in CELO"} note={w.balances ? `CELO balance ${Number(w.balances.CELO).toFixed(4)}` : undefined} />
          </div>
          <p className="mt-4 max-w-2xl text-[12px] text-muted">
            Conversion and merchant settlement are separate transactions. If the conversion succeeds and settlement fails, the converted {dstTok} stays in your wallet.
          </p>
        </section>

        <aside className="bg-paper-2/60 px-4 py-10 sm:px-8 lg:px-8">
          {!record ? (
            <>
              <div className="kicker mb-4">Authorise</div>
              {blockers.length > 0 && (
                <ul className="mb-6 space-y-2 border-l-2 border-alert pl-3 text-[13px] text-alert">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )}
              {!w.address ? (
                <button className="btn btn-primary w-full" onClick={w.connect} disabled={w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>
              ) : !w.onCelo ? (
                <button className="btn btn-primary w-full" onClick={w.switchToCelo}>Switch to Celo</button>
              ) : (
                <>
                  <ol className="mb-6 space-y-3 text-[13px]">
                    {plan.needsConversion && <li className="grid grid-cols-[22px_1fr]"><span className="num text-faint">1</span><span>Request a firm Textile FX quote bound to your wallet{" "}<span className="text-muted">(may ask you to sign a no-cost proof of control)</span></span></li>}
                    {plan.needsConversion && <li className="grid grid-cols-[22px_1fr]"><span className="num text-faint">2</span><span>Approve the Textile reactor for the exact amount, if needed</span></li>}
                    {plan.needsConversion && <li className="grid grid-cols-[22px_1fr]"><span className="num text-faint">3</span><span>Send the conversion transaction</span></li>}
                    <li className="grid grid-cols-[22px_1fr]"><span className="num text-faint">{plan.needsConversion ? 4 : 1}</span><span>{plan.method === "x402" ? "Sign the x402 payment authorisation" : "Send the merchant transfer"}</span></li>
                  </ol>
                  <label className="mb-5 flex items-start gap-3 text-[13px]">
                    <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    <span>I authorise these Celo mainnet transactions from {w.address.slice(0, 6)}…{w.address.slice(-4)}. They cannot be reversed.</span>
                  </label>
                  <button className="btn btn-primary w-full" disabled={!canRun} onClick={run}>Approve and pay</button>
                </>
              )}
              {w.error && <p className="mt-3 text-[12px] text-alert">{w.error}</p>}
              {!w.hasProvider && !w.address && <p className="mt-3 text-[12px] text-muted">No browser wallet detected. Open subscan in MiniPay or a browser with MetaMask, Valora or Rabby.</p>}
              {!recipient && (
                <Link href={`/subscriptions/${encodeURIComponent(sub.id)}#settlement`} className="btn btn-ghost mt-3 w-full bg-paper">Add merchant payment details</Link>
              )}
              <div className="mt-8 border-t rule pt-5">
                <div className="mb-1 text-[13px] font-medium">Not ready to pay?</div>
                <p className="mb-3 text-[12px] text-muted">Save this as a prepared payment. Nothing is signed or broadcast; it appears in your history as Prepared.</p>
                <button className="btn btn-ghost w-full bg-paper" disabled={!destAtomic || !dstTok || draftSaved} onClick={saveDraft}>{draftSaved ? "Saved to payments" : "Save as prepared payment"}</button>
                {draftSaved && <Link href="/activity" className="mt-2 block text-center text-[12px] link">View in payments →</Link>}
              </div>
            </>
          ) : (
            <Progress record={record} running={running} err={err} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, note, strong }: { k: string; v: React.ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b rule py-4">
      <div>
        <div className="text-[14px] text-muted">{k}</div>
        {note && <div className="mt-0.5 max-w-xs text-[11px] text-faint">{note}</div>}
      </div>
      <div className={`num max-w-[60%] text-right ${strong ? "display text-[26px]" : "text-[14px]"}`}>{v}</div>
    </div>
  );
}

function Progress({ record, running, err }: { record: PaymentRecord; running: boolean; err?: string }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="kicker">Transactions</div>
        <TxStatus status={record.status} />
      </div>
      <ol className="border-t border-ink">
        {record.steps.map((s) => (
          <li key={s.kind} className="border-b rule py-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px]">{s.label}</span>
              <TxStatus status={s.status} />
            </div>
            {s.hash && <div className="mt-1"><HashLink hash={s.hash} /></div>}
            {s.error && <div className="mt-1 text-[12px] text-alert">{s.error}</div>}
          </li>
        ))}
      </ol>
      {running && <p className="mt-4 text-[13px] text-muted">Confirm each step in your wallet. Keep this page open.</p>}
      {err && <p className="mt-4 text-[13px] text-alert">{err}</p>}
      {!running && (
        <div className="mt-6 flex gap-3">
          <Link href={`/activity/${record.id}`} className="btn btn-primary">View receipt</Link>
          <Link href="/" className="btn btn-ghost">Overview</Link>
        </div>
      )}
    </div>
  );
}

