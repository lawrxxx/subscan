const SYMBOL: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€" };

export function money(amount: number, currency: string, opts: { compact?: boolean; decimals?: number } = {}) {
  const sym = SYMBOL[currency];
  const decimals = opts.decimals ?? (currency === "NGN" ? 0 : 2);
  const n = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: opts.compact ? 0 : decimals,
    maximumFractionDigits: opts.compact ? (Math.abs(amount) >= 1000 ? 0 : decimals) : decimals,
    notation: opts.compact && Math.abs(amount) >= 1_000_000 ? "compact" : "standard",
  });
  const sign = amount < 0 ? "−" : "";
  return sym ? `${sign}${sym}${n}` : `${sign}${n} ${currency}`;
}

export function moneyParts(amount: number, currency: string) {
  const sym = SYMBOL[currency] ?? "";
  const decimals = currency === "NGN" ? 0 : 2;
  const [int, frac] = amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).split(".");
  return { sym, int, frac, code: currency };
}

export function date(d: string, style: "short" | "long" | "day" = "short") {
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (style === "day") return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (style === "long") return dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function daysUntil(d: string, today = new Date().toISOString().slice(0, 10)) {
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function relDays(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}

export function shortHash(h: string, n = 6) {
  return h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h;
}

export const FREQ_LABEL = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" } as const;
export const PER = { weekly: "/wk", monthly: "/mo", quarterly: "/qtr", yearly: "/yr" } as const;

/** Rewrites ISO dates inside generated text ("on 2026-08-03") as "on 3 Aug 2026". */
export function readableDates(text: string) {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => date(d));
}

/** Display name for a payee key such as "salary-credit" → "Salary Credit". */
export function payeeName(merchant: string) {
  if (!/^[a-z0-9-]+$/.test(merchant)) return merchant;
  return merchant.split("-").filter(Boolean).map((w) => (w.length <= 3 && /\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** A readable name for a statement line. Never returns a bare reference number. */
export function txLabel(t: { merchant: string; description: string }) {
  const name = payeeName(t.merchant);
  const letters = name.replace(/[^A-Za-z]/g, "").length;
  const digits = name.replace(/\D/g, "").length;
  const looksLikeRef = letters < 3 || digits >= 4 || /[a-z]*\d+[a-z]+\d/i.test(name);
  if (!looksLikeRef) return name;
  if (/\b(nip|trf|transfer|tfr)\b/i.test(t.description)) return "Bank transfer";
  if (/\b(pos|card|web)\b/i.test(t.description)) return "Card payment";
  return "Unknown payee";
}

/** Short cadence for compact rows: "About once a month" -> "Monthly". Presentation only. */
export function shortCadence(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.replace(/^about\s+/i, "").toLowerCase();
  const map: Record<string, string> = { "once a week": "weekly", "once a month": "monthly", "once a year": "yearly", "every three months": "quarterly", "every 3 months": "quarterly", "every two weeks": "every 2 weeks" };
  const out = map[t] ?? t;
  return out[0].toUpperCase() + out.slice(1);
}
