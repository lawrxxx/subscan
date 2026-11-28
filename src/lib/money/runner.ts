"use client";
// Runs the planner while subscan is open, one tab at a time, and records every
// movement before, during and after it happens. Nothing runs when subscan is closed.
import { useEffect, useRef } from "react";
import { formatUnits, parseUnits } from "viem";
import { TOKENS, type TokenSymbol } from "../celo/config";
import { execute, status as walletStatus, type ExecuteRequest } from "../autopilot/browser";
import type { useStore } from "../db/store";
import type { Activity, AppState } from "../types";
import { plan, type Step } from "./plan";
import type { Balances } from "./rules";
import { verifyTransfer } from "./verify";

type StoreApi = ReturnType<typeof useStore>;

export const CYCLE_MS = 60_000;
/** A "processing" record with no transaction hash this old is treated as lost. */
const LOST_AFTER_MS = 15 * 60_000;

const iso = () => new Date().toISOString();
const rid = () => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const human = (atomic: string, t: TokenSymbol) => formatUnits(BigInt(atomic), TOKENS[t].decimals);
/** Whole-unit amount → atomic, rounded down to the token's precision. */
export const atomicOf = (v: number | string, t: TokenSymbol) => parseUnits(Number(v).toFixed(TOKENS[t].decimals), TOKENS[t].decimals).toString();

export function accessState(s: AppState): "none" | "revoked" | "expired" | "off" | "on" {
  const ap = s.autopilot;
  if (!ap?.sealedPolicy) return "none";
  if (ap.revokedAt) return "revoked";
  if ((ap.expiry ?? 0) * 1000 <= Date.now()) return "expired";
  return ap.enabled ? "on" : "off";
}

let rateCache: { at: number; v: number | null } | null = null;
export async function liveRate(): Promise<number | null> {
  if (rateCache && Date.now() - rateCache.at < 60_000) return rateCache.v;
  const v = await fetch("/api/fx/rate").then((r) => r.json()).then((j) => (j.data?.ngnPerUsd as number) ?? null).catch(() => null);
  rateCache = { at: Date.now(), v };
  return v;
}

export async function readBalances(s: AppState): Promise<Balances | null> {
  const ap = s.autopilot;
  if (!ap?.sealedPolicy || ap.revokedAt) return null;
  const st = await walletStatus(ap.sealedPolicy, ap.wallet).catch(() => null);
  if (!st) return null;
  return { USDT: Number(human(st.balances.USDT, "USDT")), cNGN: Number(human(st.balances.cNGN, "cNGN")) };
}

function requestFor(a: Activity, extra?: { maxSell?: number; buyAmount?: number; sellAmount?: number }): ExecuteRequest {
  if (a.kind === "transfer") return { kind: "transfer", key: a.key, token: a.token, amountAtomic: atomicOf(a.amount, a.token), recipient: a.recipient! };
  const buy = a.toToken!;
  const r: ExecuteRequest = { kind: "convert", key: a.key, sellToken: a.token, buyToken: buy };
  if (extra?.buyAmount) r.buyAmountAtomic = atomicOf(extra.buyAmount, buy);
  else r.sellAmountAtomic = atomicOf(extra?.sellAmount ?? a.amount, a.token);
  if (extra?.maxSell) r.maxSellAtomic = atomicOf(extra.maxSell, a.token);
  return r;
}

/**
 * Send one movement through the payment wallet and record the outcome.
 * The record is saved as "processing" before the request leaves the browser.
 */
export async function runActivity(store: StoreApi, a: Activity, sizing?: { maxSell?: number; buyAmount?: number; sellAmount?: number }): Promise<Activity> {
  const s = store.get();
  const ap = s.autopilot;
  const access = accessState(s);
  if (!ap?.sealedPolicy || access === "none" || access === "revoked" || access === "expired") {
    const failed = { ...a, status: "failed" as const, updatedAt: iso(), error: access === "expired" ? "subscan's access has expired. Renew it in Settings." : "subscan doesn't have access to your payment wallet." };
    store.upsertActivity(failed);
    return failed;
  }
  const processing: Activity = { ...a, status: "processing", updatedAt: iso(), error: undefined, refusals: undefined };
  store.upsertActivity(processing);
  let res;
  try {
    res = await execute(ap.sealedPolicy, ap.wallet, requestFor(a, sizing));
  } catch (e) {
    const failed = { ...processing, status: "failed" as const, updatedAt: iso(), error: `${(e as Error).message}. Check your connection; nothing was confirmed.` };
    store.upsertActivity(failed);
    return failed;
  }
  const withQuote: Activity = res.quote
    ? { ...processing, amount: human(res.quote.takerPays, res.quote.sellToken), toAmount: human(res.quote.buyAmount, res.quote.buyToken), fee: human(res.quote.feeAmount, res.quote.sellToken), rfqId: res.quote.rfqId }
    : processing;
  if (res.status === "refused") {
    const failed = { ...withQuote, status: "failed" as const, updatedAt: iso(), refusals: res.refusalText, error: res.error ? `Textile FX: ${res.error}` : undefined };
    store.upsertActivity(failed);
    return failed;
  }
  if (res.status === "failed" && !res.transactionHash) {
    const failed = { ...withQuote, status: "failed" as const, updatedAt: iso(), error: res.error };
    store.upsertActivity(failed);
    return failed;
  }
  const sent: Activity = { ...withQuote, txHash: res.transactionHash, updatedAt: iso(), status: res.status === "failed" ? "failed" : "processing", error: res.status === "failed" ? res.error : undefined };
  store.upsertActivity(sent);
  return sent.status === "processing" ? confirm(store, sent) : sent;
}

/** Re-read the receipt in the browser before showing "completed". */
export async function confirm(store: StoreApi, a: Activity): Promise<Activity> {
  if (!a.txHash) return a;
  const wallet = store.get().autopilot?.wallet;
  const expect = a.kind === "transfer" ? { token: a.token, to: a.recipient!, minAmount: a.amount } : { token: a.toToken!, to: wallet!, minAmount: a.toAmount ?? "0" };
  const v = await verifyTransfer(a.txHash, expect);
  if (v.state === "pending") return a;
  const next: Activity = v.state === "confirmed" ? { ...a, status: "completed", verifiedAt: iso(), updatedAt: iso() } : { ...a, status: "failed", error: v.why, updatedAt: iso() };
  store.upsertActivity(next);
  return next;
}

function recordFromStep(st: Step): Activity | null {
  const t = iso();
  if (st.type === "send" || st.type === "ask" || st.type === "block")
    return {
      id: rid(),
      kind: "transfer",
      status: st.type === "send" ? "processing" : st.type === "ask" ? "awaiting_approval" : "failed",
      createdAt: t,
      updatedAt: t,
      key: st.key,
      scheduleId: st.schedule.id,
      occurrence: st.date,
      token: st.token,
      amount: st.amount,
      recipient: st.recipient?.address,
      recipientName: st.recipient?.name,
      ...(st.type === "ask" ? { note: st.why } : st.type === "block" ? { error: st.why } : {}),
    };
  if (st.type === "convert" || st.type === "ask_convert") {
    const n = st.need;
    return {
      id: rid(),
      kind: "conversion",
      status: st.type === "convert" ? "processing" : "awaiting_approval",
      createdAt: t,
      updatedAt: t,
      key: st.key,
      ruleId: st.rule.id,
      token: n.sellToken,
      toToken: n.buyToken,
      amount: String(n.sellAmount ?? ""),
      toAmount: n.buyAmount !== undefined ? String(n.buyAmount) : undefined,
      note: n.reason,
    };
  }
  return null;
}

/** One pass: finish pending checks, plan, and act on what's due. */
export async function cycle(store: StoreApi, onNote?: (m: string) => void) {
  const s0 = store.get();
  // 1. Finish anything waiting for Celo; flag records we lost track of.
  for (const a of s0.activity.filter((x) => x.status === "processing")) {
    if (a.txHash) await confirm(store, a);
    else if (Date.now() - Date.parse(a.updatedAt) > LOST_AFTER_MS)
      store.patchActivity(a.id, { status: "failed", error: "subscan lost track of this before it was confirmed. Check your payment wallet's history before trying again." });
  }
  if (accessState(store.get()) !== "on") return;
  const [balances, ngnPerUsd] = await Promise.all([readBalances(store.get()), liveRate()]);
  const today = new Date().toISOString().slice(0, 10);
  const steps = plan(store.get(), { today, nowMs: Date.now(), balances, ngnPerUsd });

  for (const st of steps) {
    if (st.type === "end") {
      store.upsertSchedule({ ...st.schedule, status: "ended", updatedAt: iso() });
      continue;
    }
    const rec = recordFromStep(st);
    if (!rec) continue;
    // Re-check against the latest saved state: another pass may have taken this key.
    if (store.get().activity.some((a) => a.key === rec.key)) continue;
    if (st.type === "block" && st.end) store.upsertSchedule({ ...st.schedule, status: "ended", updatedAt: iso() });
    if (rec.status !== "processing") {
      store.upsertActivity(rec);
      continue;
    }
    if (st.type === "convert") {
      const r = store.get().rules.find((x) => x.id === st.rule.id);
      const done = await runActivity(store, rec, { maxSell: st.need.maxSell, buyAmount: st.need.buyAmount, sellAmount: st.need.sellAmount });
      if (r) store.upsertRule({ ...r, lastCheckedAt: iso(), lastRunAt: iso(), lastOutcome: done.status === "completed" ? "Converted" : done.refusals?.[0] ?? done.error ?? done.status });
      onNote?.(done.status === "completed" ? `Converted ${done.amount} ${TOKENS[done.token].display} to ${done.toAmount} ${TOKENS[done.toToken!].display}.` : `A money rule couldn't convert: ${done.refusals?.[0] ?? done.error ?? "see activity"}.`);
    } else {
      const done = await runActivity(store, rec);
      onNote?.(done.status === "completed" ? `Sent ${done.amount} ${TOKENS[done.token].display} to ${done.recipientName}.` : done.status === "processing" ? `Sending to ${done.recipientName}…` : `A transfer to ${done.recipientName} didn't go through: ${done.refusals?.[0] ?? done.error ?? "see activity"}.`);
    }
  }
  // Mark rules as checked even when they had nothing to do.
  const t = iso();
  for (const r of store.get().rules) if (r.status === "active" && r.kind !== "transfer_cap") store.upsertRule({ ...r, lastCheckedAt: t });
}

/** Mount once (in the app shell). Runs a pass on open and every minute, in one tab only. */
export function useMoneyRunner(store: StoreApi, onNote?: (m: string) => void) {
  const ref = useRef(store);
  ref.current = store;
  const note = useRef(onNote);
  note.current = onNote;
  useEffect(() => {
    if (!store.ready) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const run = () => cycle(ref.current, (m) => note.current?.(m)).catch(() => {});
      if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request("subscan-money-runner", { ifAvailable: true }, async (lock) => (lock ? run() : undefined));
      else await run();
    };
    void tick();
    const id = setInterval(tick, CYCLE_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [store.ready]);
}

/** Next check time for display. */
export const nextCheck = (last?: string) => (last ? new Date(Date.parse(last) + CYCLE_MS).toISOString() : undefined);
