import type { Subscription } from "../types.ts";
import { MONTHLY_FACTOR, toTime } from "./engine.ts";

const DAY = 86_400_000;

/** Rates expressed as units of home currency per 1 unit of foreign currency. */
export type RateTable = Record<string, number>;

export function active(subs: Subscription[]) {
  return subs.filter((s) => s.status !== "dismissed");
}

/** Still being charged: not dismissed and not lapsed. Used for totals and renewals. */
export function live(subs: Subscription[]) {
  return active(subs).filter((s) => !s.lapsed);
}

export function monthlyEquivalent(s: Subscription) {
  return s.amount * MONTHLY_FACTOR[s.frequency];
}

export function toHome(amount: number, currency: string, home: string, rates: RateTable): number | null {
  if (currency === home) return amount;
  const r = rates[currency];
  return r ? amount * r : null;
}

export interface SpendSummary {
  home: string;
  byCurrency: { currency: string; monthly: number; annual: number; count: number }[];
  monthlyHome: number | null; // null when a currency lacks a rate
  annualHome: number | null;
  unconverted: string[];
  activeCount: number;
  lapsedCount: number;
  confirmedCount: number;
  byCategory: { category: string; monthlyHome: number }[];
}

export function spendSummary(subs: Subscription[], home: string, rates: RateTable = {}): SpendSummary {
  const list = live(subs);
  const map = new Map<string, { monthly: number; count: number }>();
  for (const s of list) {
    const cur = map.get(s.currency) ?? { monthly: 0, count: 0 };
    cur.monthly += monthlyEquivalent(s);
    cur.count++;
    map.set(s.currency, cur);
  }
  const byCurrency = [...map.entries()]
    .map(([currency, v]) => ({ currency, monthly: v.monthly, annual: v.monthly * 12, count: v.count }))
    .sort((a, b) => (a.currency === home ? -1 : b.currency === home ? 1 : b.monthly - a.monthly));
  const unconverted = byCurrency.filter((c) => c.currency !== home && !rates[c.currency]).map((c) => c.currency);
  const monthlyHome = unconverted.length
    ? null
    : byCurrency.reduce((sum, c) => sum + (toHome(c.monthly, c.currency, home, rates) ?? 0), 0);
  const cat = new Map<string, number>();
  for (const s of list) {
    const v = toHome(monthlyEquivalent(s), s.currency, home, rates);
    if (v !== null) cat.set(s.category, (cat.get(s.category) ?? 0) + v);
  }
  return {
    home,
    byCurrency,
    monthlyHome,
    annualHome: monthlyHome === null ? null : monthlyHome * 12,
    unconverted,
    activeCount: list.length,
    lapsedCount: active(subs).filter((s) => s.lapsed).length,
    confirmedCount: list.filter((s) => s.status === "confirmed").length,
    byCategory: [...cat.entries()].map(([category, monthlyHome]) => ({ category, monthlyHome })).sort((a, b) => b.monthlyHome - a.monthlyHome),
  };
}

export function upcomingRenewals(subs: Subscription[], today: string, withinDays = 30) {
  const t0 = toTime(today);
  return live(subs)
    .map((s) => ({ ...s, daysUntil: Math.round((toTime(s.nextRenewal) - t0) / DAY) }))
    .filter((s) => s.daysUntil >= 0 && s.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export function priceChanges(subs: Subscription[]) {
  return active(subs)
    .filter((s) => s.priceChange)
    .sort((a, b) => toTime(b.priceChange!.date) - toTime(a.priceChange!.date));
}

export interface DuplicateGroup {
  reason: string;
  subscriptions: Subscription[];
}

/** Same merchant billed twice, or several services in an overlapping category. */
export function duplicates(subs: Subscription[]): DuplicateGroup[] {
  const list = active(subs);
  const groups: DuplicateGroup[] = [];
  const byMerchant = new Map<string, Subscription[]>();
  for (const s of list) byMerchant.set(s.merchant, [...(byMerchant.get(s.merchant) ?? []), s]);
  for (const [, g] of byMerchant)
    if (g.length > 1) groups.push({ reason: `${g[0].displayName} is billed ${g.length} times on separate plans`, subscriptions: g });
  const overlap = ["Streaming", "Music", "Cloud & apps", "TV"];
  for (const cat of overlap) {
    const g = list.filter((s) => s.category === cat);
    const merchants = new Set(g.map((s) => s.merchant));
    if (merchants.size > 1 && cat !== "Streaming") groups.push({ reason: `${merchants.size} overlapping ${cat.toLowerCase()} services`, subscriptions: g });
    if (cat === "Streaming" && merchants.size > 2) groups.push({ reason: `${merchants.size} streaming services running at once`, subscriptions: g });
  }
  return groups;
}

export interface WasteFlag {
  subscriptionId: string;
  name: string;
  reason: string;
  monthlyHome: number | null;
  currency: string;
  monthly: number;
}

export function wasteCandidates(subs: Subscription[], home: string, rates: RateTable, today: string): WasteFlag[] {
  const flags = new Map<string, WasteFlag>();
  const add = (s: Subscription, reason: string) => {
    const existing = flags.get(s.id);
    if (existing) existing.reason += `; ${reason}`;
    else
      flags.set(s.id, {
        subscriptionId: s.id,
        name: s.displayName,
        reason,
        monthly: monthlyEquivalent(s),
        currency: s.currency,
        monthlyHome: toHome(monthlyEquivalent(s), s.currency, home, rates),
      });
  };
  for (const g of duplicates(subs)) {
    const sorted = [...g.subscriptions].sort((a, b) => monthlyEquivalent(a) - monthlyEquivalent(b));
    // flag all but the most expensive (likely the one in use) — user decides
    sorted.slice(0, -1).forEach((s) => add(s, g.reason));
  }
  for (const s of priceChanges(subs)) if (s.priceChange!.pct > 0.1) add(s, `price rose ${Math.round(s.priceChange!.pct * 100)}% on ${s.priceChange!.date}`);
  for (const s of active(subs)) {
    const days = (toTime(today) - toTime(s.lastCharge)) / DAY;
    if (days > s.intervalDays * 2.2) add(s, `no charge in ${Math.round(days)} days — confirm it is cancelled`);
    if (s.frequency === "yearly") add(s, "annual plan renews as a single large charge");
  }
  return [...flags.values()].sort((a, b) => (b.monthlyHome ?? 0) - (a.monthlyHome ?? 0));
}
