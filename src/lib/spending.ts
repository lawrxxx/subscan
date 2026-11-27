// Spending summaries over the user's imported transactions. Periods end on the
// latest transaction date (statements are historical), and a comparison with the
// previous period is only given when the statement fully covers it.
import { txCategory } from "./attention.ts";
import type { AppState, Subscription, Transaction } from "./types.ts";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface CategoryTotal {
  name: string;
  amount: number;
  count: number;
  bill: boolean;
}

export interface SpendingSummary {
  days: number;
  from: string;
  to: string;
  total: number;
  moneyIn: number;
  previous: number | null;
  categories: CategoryTotal[];
  largest: (Transaction & { category: string })[];
  transactions: (Transaction & { category: string; billName?: string; billId?: string })[];
  currency: string;
  otherCurrencies: string[];
}

export function spendingSummary(state: AppState, days: number): SpendingSummary | null {
  const home = state.settings.homeCurrency;
  const txs = state.transactions;
  if (!txs.length) return null;
  const last = txs.reduce((m, t) => (t.date > m ? t.date : m), "");
  const first = txs.reduce((m, t) => (t.date < m ? t.date : m), last);
  const end = Date.parse(`${last}T00:00:00Z`);
  const from = iso(end - (days - 1) * DAY);
  const prevFrom = iso(end - (2 * days - 1) * DAY);
  const bills = new Map<string, Subscription>(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => [s.merchant, s]));

  const inRange = txs.filter((t) => t.date >= from && t.date <= last);
  const out = inRange.filter((t) => (t.direction ?? "debit") === "debit" && t.currency === home);
  const others = [...new Set(inRange.filter((t) => t.currency !== home).map((t) => t.currency))];
  const tagged = inRange
    .map((t) => {
      const c = txCategory(t, bills);
      return { ...t, category: c.category, billName: c.bill?.displayName, billId: c.bill?.id };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const cats = new Map<string, CategoryTotal>();
  for (const t of tagged) {
    if ((t.direction ?? "debit") !== "debit" || t.currency !== home) continue;
    const c = cats.get(t.category) ?? { name: t.category, amount: 0, count: 0, bill: !!t.billId };
    c.amount += t.amount;
    c.count += 1;
    cats.set(t.category, c);
  }
  const prevCovered = first <= prevFrom;
  const previous = prevCovered ? txs.filter((t) => t.date >= prevFrom && t.date < from && (t.direction ?? "debit") === "debit" && t.currency === home).reduce((x, t) => x + t.amount, 0) : null;

  return {
    days,
    from,
    to: last,
    total: out.reduce((x, t) => x + t.amount, 0),
    moneyIn: inRange.filter((t) => t.direction === "credit" && t.currency === home).reduce((x, t) => x + t.amount, 0),
    previous,
    categories: [...cats.values()].sort((a, b) => b.amount - a.amount),
    largest: tagged.filter((t) => (t.direction ?? "debit") === "debit" && t.currency === home).sort((a, b) => b.amount - a.amount).slice(0, 5),
    transactions: tagged,
    currency: home,
    otherCurrencies: others,
  };
}

/** How many days of statement history we have. */
export function historyDays(state: AppState) {
  if (!state.transactions.length) return 0;
  const d = state.transactions.map((t) => t.date).sort();
  return Math.round((Date.parse(d[d.length - 1]) - Date.parse(d[0])) / DAY) + 1;
}
