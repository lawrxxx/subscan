"use client";
// The autonomous part: find bills the user switched to "Auto" that are due,
// and ask the server to pay them. Every outcome, paid or refused, becomes a
// payment record with its stage, so nothing happens silently.
import { useEffect, useRef } from "react";
import { parseUnits } from "viem";
import { TOKENS, tokenForCurrency } from "../celo/config";
import type { useStore } from "../db/store";
import { idempotencyKey, STAGE_LABEL } from "../payments/engine";
import type { PaymentRecord, Subscription } from "../types";
import { payNow, type PayResponse } from "./browser";

type Store = ReturnType<typeof useStore>;
const DAY = 86_400_000;

/** Due within 2 days, or overdue by no more than 7. */
export function isDue(s: Subscription, now = Date.now()) {
  if (s.lapsed) return false;
  const due = Date.parse(`${s.nextRenewal}T00:00:00Z`);
  return due - now <= 2 * DAY && now - due <= 7 * DAY;
}

export async function runAutopilotFor(store: Store, billId: string, opts: { force?: boolean } = {}): Promise<string> {
  const { state, upsertPayment, logAction } = store;
  const ap = state.autopilot;
  const s = state.subscriptions.find((x) => x.id === billId);
  if (!ap?.sealedPolicy || !s) return "Autopilot isn't set up.";
  const token = s.payment?.token ?? tokenForCurrency(s.currency);
  if (!token || !s.payment?.address) return `${s.displayName} has no verified wallet address.`;
  const dueDate = s.nextRenewal;
  const idem = idempotencyKey(ap.wallet, { billId: s.id, dueDate });
  const prior = state.payments.find((p) => p.idempotencyKey === idem && (p.status === "confirmed" || p.status === "pending"));
  if (prior && !opts.force) return `${s.displayName} is already paid for ${dueDate}.`;
  const amountAtomic = parseUnits(s.amount.toFixed(TOKENS[token].decimals), TOKENS[token].decimals).toString();

  const rec: PaymentRecord = {
    id: `ap_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    subscriptionId: s.id,
    merchant: s.displayName,
    sourceToken: token,
    destinationToken: token,
    sourceAmount: s.amount.toLocaleString("en-US"),
    destinationAmount: s.amount.toLocaleString("en-US"),
    recipient: s.payment.address,
    method: "address",
    steps: [{ kind: "settlement", label: `Autopilot pays ${s.displayName}`, status: "pending", at: new Date().toISOString() }],
    status: "pending",
    from: ap.wallet,
    via: "autopilot",
    idempotencyKey: idem,
    stage: "prepared",
  };
  upsertPayment(rec);
  const r = await payNow({ sealedPolicy: ap.sealedPolicy, wallet: ap.wallet, enabled: ap.enabled, alreadyPaid: !!prior && !opts.force, request: { billId: s.id, billName: s.displayName, recipient: s.payment.address, token, amountAtomic, dueDate } }).catch((e: Error): PayResponse => ({ ok: false, stage: "failed", error: e.message, source: token, idempotencyKey: idem }));

  const converted = !!r.quote && r.source !== token;
  const steps: PaymentRecord["steps"] = [
    ...(converted ? [{ kind: "conversion" as const, label: `Convert ${TOKENS[r.source].display} → ${TOKENS[token].display} via Textile FX (same transaction)`, status: (r.ok ? "confirmed" : r.stage === "submitted" ? "pending" : "failed") as PaymentRecord["status"], hash: r.transactionHash, at: new Date().toISOString() }] : []),
    { kind: "settlement", label: `Autopilot pays ${s.displayName}`, status: r.ok ? "confirmed" : r.stage === "submitted" ? "pending" : "failed", hash: r.transactionHash, error: r.ok ? undefined : r.refusalText?.join(" ") || r.error, at: new Date().toISOString() },
  ];
  const done: PaymentRecord = {
    ...rec,
    steps,
    sourceToken: r.source,
    sourceAmount: converted && r.quote ? (Number(r.quote.takerPays) / 10 ** TOKENS[r.source].decimals).toLocaleString("en-US", { maximumFractionDigits: 4 }) : rec.sourceAmount,
    rfqId: r.quote?.rfqId,
    status: r.ok ? "confirmed" : r.stage === "submitted" ? "pending" : "failed",
    stage: r.ok ? "confirmed" : r.stage === "submitted" ? "submitted" : "failed",
    refusals: r.refusalText,
  };
  upsertPayment(done);
  if (r.ok) {
    logAction({ kind: "payment-sent", title: `Autopilot paid ${s.displayName}`, detail: `${s.amount.toLocaleString("en-US")} ${TOKENS[token].display}${converted ? " (converted via Textile FX)" : ""}`, href: `/wallet/${rec.id}` });
    return `Paid ${s.displayName}: ${s.amount.toLocaleString("en-US")} ${TOKENS[token].display}. ${STAGE_LABEL.confirmed}.`;
  }
  const why = r.refusalText?.join(" ") || r.error || "It couldn't be paid.";
  return `Autopilot didn't pay ${s.displayName}. ${why}`;
}

/** Runs once per app open: pays due bills marked Auto. */
export function useAutopilotRunner(store: Store, onResult: (msg: string) => void) {
  const ran = useRef(false);
  useEffect(() => {
    const ap = store.state.autopilot;
    if (!store.ready || ran.current || !ap?.enabled || !ap.sealedPolicy || ap.revokedAt) return;
    ran.current = true;
    const due = store.state.subscriptions.filter((s) => s.autopay && s.status !== "dismissed" && isDue(s));
    (async () => {
      for (const s of due) onResult(await runAutopilotFor(store, s.id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready]);
}
