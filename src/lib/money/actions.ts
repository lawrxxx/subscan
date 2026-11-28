"use client";
// Things the user does to a single activity: approve, retry, cancel.
import type { useStore } from "../db/store";
import type { Activity } from "../types";
import { evaluateRule } from "./rules";
import { liveRate, readBalances, runActivity } from "./runner";

type StoreApi = ReturnType<typeof useStore>;
const iso = () => new Date().toISOString();

/** Re-size a conversion from today's balances; null when the rule no longer needs it. */
async function conversionSizing(store: StoreApi, a: Activity) {
  const rule = store.get().rules.find((r) => r.id === a.ruleId);
  if (!rule) return { error: "The money rule behind this was deleted." };
  const [bal, rate] = await Promise.all([readBalances(store.get()), liveRate()]);
  if (!bal) return { error: "Balances unavailable right now. Try again in a moment." };
  const need = evaluateRule({ ...rule, status: "active" }, bal, rate);
  if (need.kind !== "convert") return { done: need.reason };
  return { sizing: { maxSell: need.maxSell, buyAmount: need.buyAmount, sellAmount: need.sellAmount } };
}

export async function approve(store: StoreApi, a: Activity): Promise<Activity> {
  if (a.status !== "awaiting_approval") return a;
  if (a.kind === "conversion") {
    const s = await conversionSizing(store, a);
    if ("done" in s) {
      const c = { ...a, status: "cancelled" as const, note: `No longer needed: ${s.done}`, updatedAt: iso() };
      store.upsertActivity(c);
      return c;
    }
    if ("error" in s) throw new Error(s.error);
    return runActivity(store, a, s.sizing);
  }
  return runActivity(store, a);
}

export function cancel(store: StoreApi, a: Activity) {
  if (a.status === "awaiting_approval" || a.status === "scheduled") store.patchActivity(a.id, { status: "cancelled" });
}

/** A retry is a new record with its own key, linked to the failed one. */
export async function retry(store: StoreApi, a: Activity): Promise<Activity> {
  if (a.status !== "failed") return a;
  const n = store.get().activity.filter((x) => x.key.startsWith(`${a.key}:retry`)).length + 1;
  const next: Activity = { ...a, id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, key: `${a.key.replace(/:retry:\d+$/, "")}:retry:${n}`, retryOf: a.id, status: "processing", txHash: undefined, verifiedAt: undefined, error: undefined, refusals: undefined, createdAt: iso(), updatedAt: iso() };
  if (a.kind === "conversion") {
    const s = await conversionSizing(store, a);
    if ("done" in s) throw new Error(`Not needed any more: ${s.done}`);
    if ("error" in s) throw new Error(s.error);
    return runActivity(store, next, s.sizing);
  }
  return runActivity(store, next);
}

/** Retrying is offered only for failures that didn't move money (or that we can't confirm moved). */
export function canRetry(a: Activity, all: Activity[]) {
  if (a.status !== "failed") return false;
  if (all.some((x) => x.retryOf === a.id)) return false;
  if (a.kind === "transfer" && a.scheduleId && all.some((x) => x.scheduleId === a.scheduleId && x.occurrence === a.occurrence && x.status === "completed")) return false;
  return true;
}
