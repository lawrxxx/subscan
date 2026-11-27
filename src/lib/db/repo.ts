// Database access for the signed-in user. All functions take a Supabase client
// that acts as the user, so row-level security enforces ownership.
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine.ts";
import type { AppSettings, AppState, PaymentRecord, Subscription, Transaction } from "../types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function subToRow(s: Subscription, userId: string): Row {
  return {
    user_id: userId,
    id: s.id,
    merchant: s.merchant,
    display_name: s.displayName.slice(0, 80),
    category: s.category.slice(0, 40),
    amount: s.amount,
    currency: s.currency,
    frequency: s.frequency,
    interval_days: s.intervalDays,
    last_charge: s.lastCharge,
    next_renewal: s.nextRenewal,
    first_seen: s.firstSeen,
    charge_count: s.chargeCount,
    total_spent: s.totalSpent,
    history: s.history,
    confidence: Math.round(s.confidence * 1000) / 1000,
    confidence_reasons: s.confidenceReasons,
    status: s.status,
    price_change: s.priceChange ?? null,
    international: s.international,
    lapsed: !!s.lapsed,
    payment: s.payment ?? null,
    edited: !!s.edited,
  };
}

export function rowToSub(r: Row): Subscription {
  return {
    id: r.id,
    merchant: r.merchant,
    displayName: r.display_name,
    category: r.category,
    amount: Number(r.amount),
    currency: r.currency,
    frequency: r.frequency,
    intervalDays: r.interval_days,
    lastCharge: r.last_charge,
    nextRenewal: r.next_renewal,
    firstSeen: r.first_seen,
    chargeCount: r.charge_count,
    totalSpent: Number(r.total_spent),
    history: r.history ?? [],
    confidence: Number(r.confidence),
    confidenceReasons: r.confidence_reasons ?? [],
    status: r.status,
    priceChange: r.price_change ?? undefined,
    international: r.international,
    lapsed: (Date.now() - Date.parse(`${r.last_charge}T00:00:00Z`)) / 86_400_000 > r.interval_days * 2.2,
    payment: r.payment ?? undefined,
    edited: r.edited,
  };
}

export function paymentToRow(p: PaymentRecord, userId: string): Row {
  return {
    id: p.id,
    user_id: userId,
    subscription_id: p.subscriptionId,
    merchant: p.merchant,
    source_token: p.sourceToken,
    destination_token: p.destinationToken,
    source_amount: p.sourceAmount,
    destination_amount: p.destinationAmount,
    fee_amount: p.feeAmount ?? null,
    rate: p.rate ?? null,
    recipient: p.recipient ?? null,
    from_address: p.from ?? null,
    method: p.method,
    rfq_id: p.rfqId ?? null,
    status: p.status,
    steps: p.steps,
    created_at: p.createdAt,
  };
}

export function rowToPayment(r: Row): PaymentRecord {
  return {
    id: r.id,
    createdAt: r.created_at,
    subscriptionId: r.subscription_id,
    merchant: r.merchant,
    sourceToken: r.source_token,
    destinationToken: r.destination_token,
    sourceAmount: r.source_amount,
    destinationAmount: r.destination_amount,
    feeAmount: r.fee_amount ?? undefined,
    rate: r.rate ?? undefined,
    recipient: r.recipient ?? undefined,
    from: r.from_address ?? undefined,
    method: r.method,
    rfqId: r.rfq_id ?? undefined,
    steps: r.steps ?? [],
    status: r.status,
  };
}

export function rowToTx(r: Row): Transaction {
  return { id: r.external_id, date: r.date, description: r.description, merchant: r.merchant, amount: Number(r.amount), currency: r.currency, source: r.source };
}

export function profileToSettings(p: Row | null): AppSettings & { displayName?: string; onboarded?: boolean } {
  return {
    homeCurrency: p?.home_currency ?? "NGN",
    payGasInUsdt: !!p?.pay_gas_in_usdt,
    wallet: p?.wallet_address ?? undefined,
    agentId: p?.agent_id ?? undefined,
    agentRegistrationTx: p?.agent_registration_tx ?? undefined,
    displayName: p?.display_name ?? undefined,
    onboarded: !!p?.onboarded,
  };
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function loadState(db: SupabaseClient, userId: string, opts: { transactions?: boolean } = {}): Promise<AppState & { transactionCount: number }> {
  const [profile, subs, pays, txCount, txs] = await Promise.all([
    db.from("subscan_profiles").select("*").eq("id", userId).maybeSingle(),
    db.from("subscan_subscriptions").select("*").eq("user_id", userId).order("next_renewal"),
    db.from("subscan_payments").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    db.from("subscan_transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    opts.transactions
      ? db.from("subscan_transactions").select("external_id,date,description,merchant,amount,currency,source").eq("user_id", userId).order("date").limit(5000)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  const p = check(profile) as Row | null;
  return {
    transactions: (check(txs) as Row[]).map(rowToTx),
    transactionCount: txCount.count ?? 0,
    subscriptions: (check(subs) as Row[]).map(rowToSub),
    payments: (check(pays) as Row[]).map(rowToPayment),
    settings: profileToSettings(p),
    importedAt: p?.imported_at ?? undefined,
    dataSource: p?.data_source ?? undefined,
  };
}

/**
 * Replace the user's imported transactions and re-run detection on the server.
 * Decisions the user already made (confirm/dismiss/edits/payment details) are kept.
 */
export async function importTransactions(db: SupabaseClient, userId: string, txs: Transaction[], source: "csv" | "sample" | "mono", homeCurrency: string) {
  const previous = (check(await db.from("subscan_subscriptions").select("*").eq("user_id", userId)) as Row[]).map(rowToSub);
  const fresh = detectSubscriptions(txs, { homeCurrency });
  const merged = mergeWithPrevious(fresh, previous);

  check(await db.from("subscan_transactions").delete().eq("user_id", userId));
  for (let i = 0; i < txs.length; i += 1000) {
    const chunk = txs.slice(i, i + 1000).map((t, j) => ({
      user_id: userId,
      external_id: (t.id || `${source}-${i + j}`).slice(0, 120),
      date: t.date,
      description: t.description.slice(0, 300),
      merchant: t.merchant.slice(0, 120),
      amount: t.amount,
      currency: t.currency,
      source,
    }));
    check(await db.from("subscan_transactions").upsert(chunk, { onConflict: "user_id,source,external_id", ignoreDuplicates: true }));
  }
  // Replace detections: delete ones no longer present, upsert the merged set.
  const keep = new Set(merged.map((s) => s.id));
  const stale = previous.filter((s) => !keep.has(s.id)).map((s) => s.id);
  if (stale.length) check(await db.from("subscan_subscriptions").delete().eq("user_id", userId).in("id", stale));
  if (merged.length) check(await db.from("subscan_subscriptions").upsert(merged.map((s) => subToRow(s, userId)), { onConflict: "user_id,id" }));
  check(await db.from("subscan_profiles").upsert({ id: userId, data_source: source, imported_at: new Date().toISOString() }, { onConflict: "id" }));
  return merged;
}

export async function clearData(db: SupabaseClient, userId: string) {
  check(await db.from("subscan_transactions").delete().eq("user_id", userId));
  check(await db.from("subscan_subscriptions").delete().eq("user_id", userId));
  check(await db.from("subscan_payments").delete().eq("user_id", userId).eq("status", "prepared"));
  check(await db.from("subscan_profiles").update({ data_source: null, imported_at: null }).eq("id", userId));
}
