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

