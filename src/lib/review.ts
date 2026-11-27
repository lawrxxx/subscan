// Plain-language presentation of detected recurring payments for the review flow.
// Everything here is derived from the user's own transactions: no invented names,
// no frequency claims the dates don't support.
import { addPeriod } from "./detection/engine.ts";
import type { Frequency, ObligationKind, Subscription, Transaction } from "./types.ts";

const DAY = 86_400_000;

export type Level = "likely" | "possible" | "review";
export const LEVEL_LABEL: Record<Level, string> = { likely: "Likely recurring", possible: "Possible recurring payment", review: "Needs your review" };

/** Gaps in days between consecutive charges. */
export function gaps(s: Subscription) {
  const d = s.history.map((h) => Date.parse(`${h.date}T00:00:00Z`)).sort((a, b) => a - b);
  return d.slice(1).map((t, i) => Math.round((t - d[i]) / DAY));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** True when 3+ charges arrive at a steady interval (each gap within 20% of the median). */
export function isRegular(s: Subscription) {
  const g = gaps(s);
  if (g.length < 2) return false;
  const m = median(g);
  return m > 0 && g.every((x) => Math.abs(x - m) <= Math.max(3, m * 0.2));
}

export function level(s: Subscription): Level {
  if (s.manual) return "likely";
  const n = s.history.length;
  if (n >= 3 && isRegular(s) && s.confidence >= 0.85) return "likely";
  if (n >= 2 && s.confidence >= 0.65) return "possible";
  return "review";
}

function cadence(days: number) {
  if (days >= 6 && days <= 8) return "about once a week";
  if (days >= 13 && days <= 16) return "about every two weeks";
  if (days >= 26 && days <= 35) return "about once a month";
  if (days >= 85 && days <= 95) return "about every three months";
  if (days >= 350 && days <= 380) return "about once a year";
  return `about every ${days} days`;
}

/** What the evidence supports, in words. Only claims a frequency when 3+ payments are evenly spaced. */
export function frequencyText(s: Subscription): string | null {
  if (s.manual) return { weekly: "Weekly", monthly: "Monthly", quarterly: "Every three months", yearly: "Yearly" }[s.frequency];
  if (!isRegular(s)) return null;
  const c = cadence(median(gaps(s)));
  return c[0].toUpperCase() + c.slice(1);
}

export function amountsVary(s: Subscription) {
  const a = s.history.map((h) => h.amount);
  return Math.max(...a) > Math.min(...a) * 1.05;
}

/** One or two short sentences explaining why we think this repeats. */
export function explain(s: Subscription, fmt: (n: number) => string): string {
  if (s.manual) return "You added this yourself.";
  const n = s.history.length;
  const g = gaps(s);
  const a = s.history.map((h) => h.amount);
  const same = !amountsVary(s);
  let first: string;
  if (n === 2) first = `We found 2 ${same ? "identical" : "similar"} payments ${g[0]} days apart.`;
  else if (isRegular(s)) first = `We found ${n} payments, ${cadence(median(g))}${same ? `, ${fmt(a[a.length - 1])} each time` : ""}.`;
  else first = `We found ${n} payments, but the gaps between them vary (${Math.min(...g)} to ${Math.max(...g)} days).`;
  const extra: string[] = [];
  if (!same) extra.push(`Amounts range from ${fmt(Math.min(...a))} to ${fmt(Math.max(...a))}.`);
  if (n === 2) extra.push("Two payments aren't enough to be sure it repeats.");
  if (s.lapsed) extra.push(`Nothing since ${s.lastCharge}, so it may have stopped.`);
  return [first, ...extra].join(" ");
}

/** Next date, only when the history supports a prediction. */
export function predictedNext(s: Subscription): string | null {
  if (s.lapsed) return null;
  if (s.manual) return s.nextRenewal;
  return isRegular(s) ? s.nextRenewal : null;
}

/** Bulk confirmation is allowed only for steady, well-evidenced matches. */
export function bulkEligible(s: Subscription) {
  return s.status === "detected" && !s.manual && level(s) === "likely" && !s.lapsed && !s.unusual && !s.missed;
}

// --- Names -----------------------------------------------------------------

/** Latest raw statement description for this payee, if we have it. */
export function rawDescription(s: Subscription, txs: Transaction[]) {
  let best: Transaction | undefined;
  for (const t of txs) if (t.merchant === s.merchant && (t.direction ?? "debit") === "debit" && (!best || t.date > best.date)) best = t;
  return best?.description;
}

/** A name a person would recognise, or "Unknown merchant" when the label is really a reference. */
export function displayLabel(s: Subscription, raw?: string): { name: string; unknown: boolean; detail?: string } {
  if (s.manual || s.edited) return { name: s.displayName, unknown: false };
  const n = s.displayName.trim();
  const letters = n.replace(/[^A-Za-z]/g, "").length;
  const digits = n.replace(/\D/g, "").length;
  const looksLikeRef = letters < 3 || digits >= 4 || /\b[A-Z0-9]*\d[A-Z0-9]*[A-Z][A-Z0-9]*\d/i.test(n) || /^(trf|nip|pos|web|ussd|ft|ref|txn|tnx)\b/i.test(n);
  if (looksLikeRef) return { name: "Unknown merchant", unknown: true, detail: raw ?? n };
  return { name: n, unknown: false, detail: raw && raw.toLowerCase() !== n.toLowerCase() ? raw : undefined };
}

// --- Categories ------------------------------------------------------------

export type Group = "subscriptions" | "utilities" | "rent" | "insurance" | "loan" | "education" | "other";
export const GROUP_LABEL: Record<Group, string> = {
  subscriptions: "Subscriptions",
  utilities: "Utilities",
  rent: "Rent",
  insurance: "Insurance",
  loan: "Loan repayments",
  education: "Education",
  other: "Other recurring payments",
};

export function groupOf(s: Subscription): Group {
  const k = s.kind ?? "subscription";
  if (s.category === "Education") return "education";
  if (k === "subscription") return "subscriptions";
  if (k === "utility") return "utilities";
  if (s.category === "Rent") return "rent";
  if (s.category === "Insurance") return "insurance";
  if (s.category === "Loan") return "loan";
  return "other";
}

/** kind + category for a chosen group, keeping a specific category (e.g. Streaming) when it still fits. */
export function groupPatch(s: Subscription, g: Group): { kind: ObligationKind; category: string } {
  const k = s.kind ?? "subscription";
  switch (g) {
    case "subscriptions":
      return { kind: "subscription", category: k === "subscription" && s.category !== "Education" ? s.category : "Other" };
    case "utilities":
      return { kind: "utility", category: k === "utility" ? s.category : "Other" };
    case "rent":
      return { kind: "obligation", category: "Rent" };
    case "insurance":
      return { kind: "obligation", category: "Insurance" };
    case "loan":
      return { kind: "obligation", category: "Loan" };
    case "education":
      return { kind: "obligation", category: "Education" };
    default:
      return { kind: "obligation", category: "Other" };
  }
}

const DAYS: Record<Frequency, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };

/** Patch for a user edit. Editing marks the payment as user-checked and recomputes the next date. */
export function editPatch(s: Subscription, e: { name: string; group: Group; amount: number; frequency: Frequency }): Partial<Subscription> {
  const variable = (s.billType ?? "fixed") === "variable";
  return {
    displayName: e.name.trim().slice(0, 80),
    ...groupPatch(s, e.group),
    amount: e.amount,
    typicalAmount: variable ? e.amount : s.typicalAmount,
    frequency: e.frequency,
    intervalDays: DAYS[e.frequency],
    nextRenewal: addPeriod(s.lastCharge, e.frequency, DAYS[e.frequency]),
    missed: undefined,
    edited: true,
  };
}
