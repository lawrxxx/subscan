import type { Frequency, Subscription, Transaction } from "../types.ts";
import { matchKnown, merchantCategory, merchantLabel, SUBSCRIPTION_HINTS } from "./merchants.ts";

const DAY = 86_400_000;

export const FREQUENCIES: { frequency: Frequency; days: number; tolerance: number }[] = [
  { frequency: "weekly", days: 7, tolerance: 2 },
  { frequency: "monthly", days: 30.44, tolerance: 5 },
  { frequency: "quarterly", days: 91.3, tolerance: 10 },
  { frequency: "yearly", days: 365.25, tolerance: 20 },
];

export const MONTHLY_FACTOR: Record<Frequency, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export function toTime(d: string) {
  return Date.parse(`${d}T00:00:00Z`);
}

export function isoDate(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function classify(intervalDays: number) {
  return FREQUENCIES.find((f) => Math.abs(intervalDays - f.days) <= f.tolerance);
}

/** Add one billing period, keeping the day-of-month for monthly-like cycles. */
export function addPeriod(date: string, frequency: Frequency, intervalDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (frequency === "weekly") return isoDate(d.getTime() + 7 * DAY);
  const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 0;
  if (!months) return isoDate(d.getTime() + intervalDays * DAY);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoDate(target.getTime());
}

export function projectNextRenewal(last: string, frequency: Frequency, intervalDays: number, today: string): string {
  let next = addPeriod(last, frequency, intervalDays);
  // Roll forward if the statement is older than one period (still "estimated").
  let guard = 0;
  while (toTime(next) < toTime(today) && guard++ < 60) next = addPeriod(next, frequency, intervalDays);
  return next;
}

/** Split a merchant's charges into amount clusters (e.g. two Netflix plans). */
function clusterByAmount(txs: Transaction[]): Transaction[][] {
  const clusters: { centre: number; items: Transaction[] }[] = [];
  for (const t of [...txs].sort((a, b) => a.amount - b.amount)) {
    const c = clusters.find((c) => Math.abs(t.amount - c.centre) / c.centre <= 0.25);
    if (c) {
      c.items.push(t);
      c.centre = c.items.reduce((s, x) => s + x.amount, 0) / c.items.length;
    } else clusters.push({ centre: t.amount, items: [t] });
  }
  return clusters.map((c) => c.items);
}

interface Candidate {
  txs: Transaction[];
  intervalDays: number;
  frequency: Frequency;
  regularity: number; // share of intervals consistent with the cadence
  amountStability: number; // 1 - coefficient of variation (excluding a single step change)
}

function evaluate(txs: Transaction[]): Candidate | null {
  const sorted = [...txs].sort((a, b) => toTime(a.date) - toTime(b.date));
  // Collapse same-day duplicates (pending + posted)
  const uniq = sorted.filter((t, i) => i === 0 || t.date !== sorted[i - 1].date || t.amount !== sorted[i - 1].amount);
  if (uniq.length < 2) return null;
  const intervals = uniq.slice(1).map((t, i) => (toTime(t.date) - toTime(uniq[i].date)) / DAY);
  const med = median(intervals);
  const cls = classify(med);
  if (!cls) return null;
  // Missed months show up as ~2x intervals: count those as consistent.
  const consistent = intervals.filter((iv) => {
    const k = Math.max(1, Math.round(iv / cls.days));
    return k <= 3 && Math.abs(iv - k * cls.days) <= cls.tolerance * k;
  }).length;
  const regularity = consistent / intervals.length;

  const amounts = uniq.map((t) => t.amount);
  // Allow one step change (price increase): measure stability on each side.
  let best = Infinity;
  for (let split = 0; split < amounts.length; split++) {
    const parts = [amounts.slice(0, split), amounts.slice(split)].filter((p) => p.length);
    const cv = Math.max(
      ...parts.map((p) => {
        const mean = p.reduce((a, b) => a + b, 0) / p.length;
        const sd = Math.sqrt(p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length);
        return mean ? sd / mean : 1;
      }),
    );
    best = Math.min(best, cv + (split > 0 ? 0.02 : 0));
  }
  return { txs: uniq, intervalDays: Math.round(med), frequency: cls.frequency, regularity, amountStability: Math.max(0, 1 - best * 4) };
}

export interface DetectOptions {
  today?: string;
  homeCurrency?: string;
  minConfidence?: number;
}

export function detectSubscriptions(transactions: Transaction[], opts: DetectOptions = {}): Subscription[] {
  const today = opts.today ?? isoDate(Date.now());
  const home = opts.homeCurrency ?? "NGN";
  const min = opts.minConfidence ?? 0.45;
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const k = `${t.merchant}|${t.currency}`;
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]);
  }

  const subs: Subscription[] = [];
  for (const [key, txs] of byMerchant) {
    if (txs.length < 2) continue;
    let candidates: Candidate[] = [];
    const whole = evaluate(txs);
    if (whole && whole.regularity >= 0.7 && whole.amountStability >= 0.5) candidates = [whole];
    else {
      // Real subscriptions bill near-identical amounts; frequent ad-hoc spend
      // at one merchant (rides, cafes) only clusters loosely.
      candidates = clusterByAmount(txs)
        .map(evaluate)
        .filter((c): c is Candidate => !!c && c.regularity >= 0.6 && c.amountStability >= 0.85);
      // Loose fallback only for merchants we know sell subscriptions.
      if (!candidates.length && whole && matchKnown(txs[0].description) && whole.regularity >= 0.5) candidates = [whole];
    }

    candidates.forEach((c, idx) => {
      const sample = c.txs[c.txs.length - 1];
      const known = matchKnown(sample.description);
      const hinted = c.txs.some((t) => SUBSCRIPTION_HINTS.test(t.description));
      const reasons: string[] = [];
      let score = 0;
      const countScore = Math.min(1, (c.txs.length - 1) / 4);
      score += 0.3 * countScore;
      reasons.push(`${c.txs.length} charges, about every ${c.intervalDays} days`);
      score += 0.3 * c.regularity;
      if (c.regularity >= 0.9) reasons.push(`Consistent ${c.frequency} cadence`);
      else reasons.push(`${Math.round(c.regularity * 100)}% of intervals match a ${c.frequency} cadence`);
      score += 0.25 * c.amountStability;
      if (c.amountStability >= 0.85) reasons.push("Amount is stable");
      if (known) {
        score += 0.15;
        reasons.push(`Known subscription merchant (${known.name})`);
      } else if (hinted) {
        score += 0.08;
        reasons.push("Description mentions a plan or subscription");
      }
      const last = c.txs[c.txs.length - 1];
      const sinceLast = (toTime(today) - toTime(last.date)) / DAY;
      const stale = sinceLast > c.intervalDays * 2.2;
      const share = c.txs.length / txs.length;
      if (share < 0.5 && !known) {
        score -= 0.3;
        reasons.push("Merchant also has many irregular charges");
      }
      if (stale) {
        score -= 0.25;
        reasons.push(`No charge for ${Math.round(sinceLast)} days — may be cancelled`);
      }
      const confidence = Math.max(0, Math.min(0.99, score));
      if (confidence < min) return;

      const history = c.txs.map((t) => ({ date: t.date, amount: t.amount }));
      let priceChange: Subscription["priceChange"];
      for (let i = history.length - 1; i > 0; i--) {
        const prev = history[i - 1].amount;
        const cur = history[i].amount;
        if (prev > 0 && Math.abs(cur - prev) / prev >= 0.03) {
          priceChange = { from: prev, to: cur, date: history[i].date, pct: (cur - prev) / prev };
          break;
        }
      }
      const merchant = key.split("|")[0];
      subs.push({
        id: `${merchant}-${sample.currency}-${idx}`,
        merchant,
        displayName: known?.name ?? merchantLabel(sample.description),
        category: merchantCategory(sample.description),
        amount: last.amount,
        currency: sample.currency,
        frequency: c.frequency,
        intervalDays: c.intervalDays,
        lastCharge: last.date,
        nextRenewal: projectNextRenewal(last.date, c.frequency, c.intervalDays, today),
        firstSeen: c.txs[0].date,
        chargeCount: c.txs.length,
        totalSpent: Math.round(c.txs.reduce((s, t) => s + t.amount, 0) * 100) / 100,
        history,
        confidence,
        confidenceReasons: reasons,
        status: "detected",
        priceChange,
        international: sample.currency !== home,
      });
    });
  }
  return subs.sort((a, b) => toTime(a.nextRenewal) - toTime(b.nextRenewal));
}

/** Merge a fresh detection run with user decisions from a previous run. */
export function mergeWithPrevious(fresh: Subscription[], previous: Subscription[]): Subscription[] {
  const prev = new Map(previous.map((s) => [s.id, s]));
  const merged = fresh.map((s) => {
    const p = prev.get(s.id);
    if (!p) return s;
    return {
      ...s,
      status: p.status,
      payment: p.payment,
      displayName: p.edited ? p.displayName : s.displayName,
      category: p.edited ? p.category : s.category,
      edited: p.edited,
    };
  });
  // keep user-confirmed subscriptions that no longer appear in the new data
  for (const p of previous) if (p.status === "confirmed" && !merged.some((m) => m.id === p.id)) merged.push(p);
  return merged;
}
