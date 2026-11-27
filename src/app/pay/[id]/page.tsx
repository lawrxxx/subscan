"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import type { PaymentRequired } from "@x402/core/types";
import { addressUrl, TOKENS, type TokenSymbol } from "@/lib/celo/config";
import { ATTRIBUTION_CODES } from "@/lib/celo/attribution";
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
import { Icon } from "@/components/ui";
import { useWallet } from "@/components/wallet";

const fmt = (atomic: string | bigint, t: TokenSymbol, dp = t === "cNGN" ? 2 : 4) =>
  Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: dp });

export default function Pay() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, upsertPayment, logAction } = useStore();
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
  if (!sub || !plan) return <Missing what="subscription" back="/payments" backLabel="All bills" />;

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
    logAction({ kind: "payment-prepared", title: `Prepared payment to ${sub.displayName}`, detail: `${fmt(destAtomic, dstTok)} ${TOKENS[dstTok].display} · not signed`, href: "/wallet" });
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
      logAction({ kind: "payment-sent", title: `Paid ${sub!.displayName}`, detail: `${rec.destinationAmount} ${TOKENS[dstTok].display} confirmed on Celo`, href: `/wallet/${rec.id}` });
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

  const sendAmt = plan.needsConversion ? (preview?.takerPays ? fmt(preview.takerPays, srcTok) : null) : destAtomic && dstTok ? fmt(destAtomic, dstTok) : null;
  const locked = running || !!record;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-4 text-[13px]">
        <Link href="/payments" className="text-muted link">Bills</Link> <span className="text-faint">/</span>{" "}
        <Link href={`/payments/${encodeURIComponent(sub.id)}`} className="text-muted link">{sub.displayName}</Link> <span className="text-faint">/</span> Pay
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <h1 className="title text-[28px] sm:text-[32px]">Pay {sub.displayName}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{sub.category} · {money(sub.amount, sub.currency)} {sub.frequency} · next due {date(sub.nextRenewal)}</p>

          <div className="panel mt-5 max-w-2xl">
            {/* You send */}
            <div className="px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <span className="label">You send</span>
                <div className="seg" role="group" aria-label="Pay from">
                  {(["USDT", "cNGN"] as TokenSymbol[]).map((t) => (
                    <button key={t} aria-pressed={source === t} disabled={locked} onClick={() => setSource(t)}>{TOKENS[t].display}</button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <span className="figure text-[30px] sm:text-[34px]">{sendAmt ?? (previewErr ? "—" : "…")}</span>
                <span className="text-[15px] font-medium">{TOKENS[srcTok].display}</span>
              </div>
              <div className="mt-1 text-[12px] text-muted num">
                {w.balances ? <>Balance {Number(w.balances[srcTok]).toLocaleString("en-US", { maximumFractionDigits: 4 })} {TOKENS[srcTok].display}{insufficient && <span className="text-alert"> · not enough</span>}</> : "Connect a wallet to see your balance"}
              </div>
            </div>

            {/* Rate strip */}
            <div className="relative border-y rule bg-paper-2/50 px-4 py-3 text-[13px] sm:px-5">
              {plan.needsConversion ? (
                <ul className="space-y-1.5">
                  <li className="flex justify-between gap-3"><span className="text-muted">Exchange rate <span className="text-faint">· indicative, refreshes every 20s</span></span><span className="num text-right">{rate ?? (previewErr ? <span className="text-alert">{previewErr}</span> : "Fetching…")}</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted">Textile FX fee <span className="text-faint">· included</span></span><span className="num">{preview?.feeAmount ? `${fmt(preview.feeAmount, srcTok)} ${TOKENS[srcTok].display}` : "—"}</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted">Network fee</span><span>{state.settings.payGasInUsdt ? "Small, paid in USD₮" : "Small, paid in CELO"}</span></li>
                </ul>
              ) : (
                <ul className="space-y-1.5">
                  <li className="flex justify-between gap-3"><span className="text-muted">Conversion</span><span>None — same token</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted">Network fee</span><span>{state.settings.payGasInUsdt ? "Small, paid in USD₮" : "Small, paid in CELO"}</span></li>
                </ul>
              )}
            </div>

            {/* Recipient gets */}
            <div className="px-4 py-4 sm:px-5">
              <span className="label">{sub.displayName} gets</span>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <span className="figure text-[30px] sm:text-[34px]">{receive && dstTok ? fmt(receive, dstTok) : "—"}</span>
                <span className="text-[15px] font-medium">{dstTok ? TOKENS[dstTok].display : ""}</span>
              </div>
              {plan.needsConversion && destAtomic && dstTok && <div className="mt-1 text-[12px] text-muted">Bill amount {fmt(destAtomic, dstTok)} {TOKENS[dstTok].display}. The firm quote must cover it in full or nothing is sent.</div>}
            </div>
          </div>

          <div className="panel mt-4 max-w-2xl">
            <div className="panel-head"><h2 className="panel-title">Payment details</h2></div>
            <dl className="text-[13px]">
              <D k="Purpose">{sub.displayName} · {sub.frequency} {sub.kind === "utility" ? "utility bill" : sub.kind === "obligation" ? "payment" : "subscription"}</D>
              <D k="Recipient" note={plan.method === "x402" ? "From the merchant's x402 payment requirement" : sub.payment?.verifiedAt ? `Verified by you ${date(sub.payment.verifiedAt.slice(0, 10))}` : sub.payment?.note}>
                {recipient ? <a href={addressUrl(recipient)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link break-all">{recipient}</a> : <span className="text-alert">No verified recipient</span>}
              </D>
              <D k="Method">{plan.method === "x402" ? `x402 (${x402?.req.method === "permit2" ? "Permit2" : "EIP-3009"})` : plan.method === "address" ? "Direct token transfer" : "—"}</D>
              <D k="Source token">{TOKENS[srcTok].display}</D>
              <D k="Destination token">{dstTok ? TOKENS[dstTok].display : "—"}</D>
              {plan.needsConversion && <D k="Conversion">Textile FX RFQ · firm quote locked at approval, valid about 60 seconds</D>}
              <D k="Network">Celo mainnet · chain 42220</D>
              <D k="Attribution" note={plan.method === "x402" ? "x402 settlements are submitted by the facilitator and are not tagged." : "ERC-8021 builder codes appended to each transaction"}><span className="font-mono text-[12px]">{ATTRIBUTION_CODES.join(", ")}</span></D>
            </dl>
          </div>
          <p className="mt-3 max-w-2xl text-[12px] text-muted">
            Conversion and settlement are separate transactions. If conversion succeeds and settlement fails, the converted {dstTok ? TOKENS[dstTok].display : "tokens"} stay in your wallet.
          </p>
        </section>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          {!record ? (
            <div className="panel">
              <div className="panel-head"><h2 className="panel-title">Review and approve</h2></div>
              <div className="px-4 py-4 sm:px-5">
                {blockers.length > 0 && (
                  <div className="mb-4 rounded-[6px] bg-alert-wash px-3 py-2.5">
                    <div className="text-[12.5px] font-medium text-alert">Before you can pay</div>
                    <ul className="mt-1 space-y-1 text-[12.5px] text-alert">{blockers.map((b) => <li key={b}>· {b}</li>)}</ul>
                  </div>
                )}
                {!w.address ? (
                  <>
                    <button className="btn btn-primary w-full" onClick={w.connect} disabled={w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>
                    {!w.hasProvider && <p className="mt-2 text-[12px] text-muted">No browser wallet found. Open subscan in MiniPay, or use MetaMask, Valora or Rabby.</p>}
                  </>
                ) : !w.onCelo ? (
                  <button className="btn btn-primary w-full" onClick={w.switchToCelo}>Switch to Celo mainnet</button>
                ) : (
                  <>
                    <div className="label mb-2">Your wallet will ask you to</div>
                    <ol className="mb-4 space-y-2 text-[13px]">
                      {[
                        ...(plan.needsConversion ? ["Sign a no-cost proof for a firm Textile FX quote", `Approve the exact ${TOKENS[srcTok].display} amount, if needed`, "Send the conversion"] : []),
                        plan.method === "x402" ? "Sign the x402 payment authorisation" : `Send ${dstTok ? TOKENS[dstTok].display : ""} to the recipient`,
                      ].map((t, i) => (
                        <li key={t} className="grid grid-cols-[20px_1fr]"><span className="num text-faint">{i + 1}</span><span>{t}</span></li>
                      ))}
                    </ol>
                    <label className="mb-4 flex items-start gap-2.5 rounded-[6px] border rule px-3 py-2.5 text-[12.5px]">
                      <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                      <span>I authorise these Celo mainnet transactions from {w.address.slice(0, 6)}…{w.address.slice(-4)}. They can&rsquo;t be reversed.</span>
                    </label>
                    <button className="btn btn-primary btn-lg w-full" disabled={!canRun} onClick={run}>
                      {sendAmt ? `Approve and pay ${sendAmt} ${TOKENS[srcTok].display}` : "Approve and pay"}
                    </button>
                  </>
                )}
                {w.error && <p className="mt-2 text-[12px] text-alert">{w.error}</p>}
                {!recipient && <Link href={`/payments/${encodeURIComponent(sub.id)}#settlement`} className="btn btn-ghost mt-3 w-full">Add recipient details</Link>}
              </div>
              <div className="border-t rule px-4 py-4 sm:px-5">
                <div className="text-[13px] font-medium">Not ready yet?</div>
                <p className="mt-0.5 mb-3 text-[12px] text-muted">Save a draft. Nothing is signed or sent; it shows in Activity as a draft.</p>
                <button className="btn btn-ghost w-full" disabled={!destAtomic || !dstTok || draftSaved} onClick={saveDraft}>{draftSaved ? "Draft saved" : "Save as draft"}</button>
                {draftSaved && <Link href="/wallet" className="mt-2 block text-center text-[12px] link">View in Activity</Link>}
              </div>
            </div>
          ) : (
            <Progress record={record} running={running} err={err} />
          )}
        </aside>
      </div>
    </div>
  );
}

function D({ k, note, children }: { k: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b rule-soft px-4 py-2.5 last:border-b-0 sm:px-5">
      <dt className="shrink-0 text-muted">{k}{note && <div className="mt-0.5 max-w-[220px] text-[11px] text-faint">{note}</div>}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function Progress({ record, running, err }: { record: PaymentRecord; running: boolean; err?: string }) {
  const head =
    record.status === "confirmed"
      ? { tone: "bg-accent-wash text-accent", icon: "check", title: "Payment confirmed", body: `${record.destinationAmount} ${TOKENS[record.destinationToken].display} reached ${record.merchant}. Every step has a Celo mainnet receipt.` }
      : record.status === "failed"
        ? { tone: "bg-alert-wash text-alert", icon: "alert", title: "Payment failed", body: err ?? "A step failed. Anything already confirmed stays on chain." }
        : { tone: "bg-info-wash text-info", icon: "clock", title: "Processing", body: "Confirm each step in your wallet and keep this page open. Nothing is marked paid until its receipt is on chain." };
  return (
    <div className="panel">
      <div className={`flex items-start gap-3 px-4 py-4 sm:px-5 ${head.tone}`}>
        <Icon name={head.icon} size={20} className={running ? "animate-pulse" : ""} />
        <div>
          <div className="text-[15px] font-semibold">{head.title}</div>
          <p className="mt-0.5 text-[12.5px] opacity-90">{head.body}</p>
        </div>
      </div>
      <ol>
        {record.steps.map((s, i) => (
          <li key={s.kind} className="grid grid-cols-[22px_1fr] gap-1 border-t rule px-4 py-3 sm:px-5">
            <span className="num pt-0.5 text-[12px] text-faint">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px]">{s.label}</span>
                <TxStatus status={s.status} />
              </div>
              {s.hash && <div className="mt-1"><HashLink hash={s.hash} /></div>}
              {s.error && <div className="mt-1 text-[12px] text-alert break-words">{s.error}</div>}
            </div>
          </li>
        ))}
      </ol>
      {!running && (
        <div className="flex gap-2 border-t rule px-4 py-3 sm:px-5">
          <Link href={`/wallet/${record.id}`} className="btn btn-primary btn-sm">View receipt</Link>
          <Link href="/" className="btn btn-ghost btn-sm">Overview</Link>
        </div>
      )}
    </div>
  );
}
