// Builds the "needs attention" queue from the user's own data only.
import { classify } from "./detection/merchants.ts";
import type { AppState, Subscription, Transaction } from "./types.ts";

export type Severity = "high" | "medium" | "low";
export interface AttentionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
  action: string;
}

const DAY = 86_400_000;

export function attentionItems(state: AppState, today: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  const live = state.subscriptions.filter((s) => s.status !== "dismissed");
  for (const p of state.payments.filter((p) => p.status === "failed").slice(0, 3))
    items.push({ id: `pf-${p.id}`, severity: "high", title: `Payment to ${p.merchant} failed`, detail: p.steps.find((s) => s.error)?.error ?? "A step didn’t complete.", href: `/activity/${p.id}`, action: "View" });
  for (const s of live.filter((s) => s.missed && !s.lapsed))
    items.push({ id: `m-${s.id}`, severity: "high", title: `${s.displayName}: expected payment missing`, detail: `Usually charged around ${s.missed!.expected}, but it isn’t in your statement.`, href: `/bills/${encodeURIComponent(s.id)}`, action: "Review" });
  const review = live.filter((s) => s.status === "detected");
  if (review.length) items.push({ id: "review", severity: "medium", title: `Check ${review.length} suggested recurring payment${review.length === 1 ? "" : "s"}`, detail: "Confirm the ones you really pay so your totals are right.", href: "/review", action: "Review" });
  for (const p of state.payments.filter((p) => p.status === "prepared").slice(0, 3))
    items.push({ id: `pd-${p.id}`, severity: "medium", title: `Finish paying ${p.merchant}`, detail: `Draft for ${p.destinationAmount} ${p.destinationToken} — nothing has been sent yet.`, href: `/pay/${encodeURIComponent(p.subscriptionId)}`, action: "Continue" });
  for (const s of live.filter((s) => s.unusual))
    items.push({ id: `u-${s.id}`, severity: "medium", title: `${s.displayName} was unusually high`, detail: `Latest ${s.unusual!.amount.toLocaleString()} vs usual ${Math.round(s.unusual!.typical).toLocaleString()} ${s.currency}.`, href: `/bills/${encodeURIComponent(s.id)}`, action: "Check" });
  for (const s of live.filter((s) => s.priceChange && s.priceChange.pct > 0 && Date.parse(today) - Date.parse(s.priceChange.date) < 120 * DAY))
    items.push({ id: `p-${s.id}`, severity: "low", title: `${s.displayName} went up ${Math.round(s.priceChange!.pct * 100)}%`, detail: `From ${s.priceChange!.from.toLocaleString()} to ${s.priceChange!.to.toLocaleString()} ${s.currency} on ${s.priceChange!.date}.`, href: `/bills/${encodeURIComponent(s.id)}`, action: "View" });
  for (const s of live.filter((s) => !s.lapsed && !s.missed && dueIn(s, today) <= 3 && dueIn(s, today) >= 0))
    items.push({ id: `d-${s.id}`, severity: "low", title: `${s.displayName} due ${dueIn(s, today) === 0 ? "today" : dueIn(s, today) === 1 ? "tomorrow" : `in ${dueIn(s, today)} days`}`, detail: `${s.billType === "variable" ? "About " : ""}${s.amount.toLocaleString()} ${s.currency}.`, href: `/bills/${encodeURIComponent(s.id)}`, action: "Open" });
  const rank = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function dueIn(s: Subscription, today: string) {
  return Math.round((Date.parse(`${s.nextRenewal}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

export interface CategorySpend {
  category: string;
  monthly: number;
  recurring: boolean;
}

/** Money out per month by category, home currency, from imported transactions. */
export function spendingByCategory(state: AppState, home: string, months = 3): { categories: CategorySpend[]; monthlyTotal: number; recurringShare: number; months: number } {
  const debits = state.transactions.filter((t) => (t.direction ?? "debit") === "debit" && t.currency === home);
  if (!debits.length) return { categories: [], monthlyTotal: 0, recurringShare: 0, months: 0 };
  const end = debits.reduce((m, t) => (t.date > m ? t.date : m), "");
  const start = new Date(Date.parse(end) - months * 30.44 * DAY).toISOString().slice(0, 10);
  const window = debits.filter((t) => t.date > start);
  const first = window.reduce((m, t) => (t.date < m ? t.date : m), end);
  const span = Math.max(1, (Date.parse(end) - Date.parse(first)) / DAY / 30.44);
  const bills = new Map(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => [s.merchant, s]));
  const map = new Map<string, { amount: number; recurring: boolean }>();
  let recurring = 0;
  for (const t of window) {
    const bill = bills.get(t.merchant);
    const cat = bill ? bill.category : classify(t.description).category === "Other" ? "Everyday spending" : classify(t.description).category;
    if (bill) recurring += t.amount;
    const cur = map.get(cat) ?? { amount: 0, recurring: !!bill };
    cur.amount += t.amount;
    map.set(cat, cur);
  }
  const total = window.reduce((x, t) => x + t.amount, 0);
  return {
    categories: [...map.entries()].map(([category, v]) => ({ category, monthly: v.amount / span, recurring: v.recurring })).sort((a, b) => b.monthly - a.monthly),
    monthlyTotal: total / span,
    recurringShare: total ? recurring / total : 0,
    months: Math.round(span * 10) / 10,
  };
}

/** Category for one transaction: the bill it belongs to, else a keyword classification. */
export function txCategory(t: Transaction, bills: Map<string, Subscription>): { category: string; bill?: Subscription } {
  if ((t.direction ?? "debit") === "credit") return { category: "Money in" };
  const bill = bills.get(t.merchant);
  if (bill) return { category: bill.category, bill };
  const c = classify(t.description).category;
  return { category: c === "Other" ? "Everyday spending" : c };
}
