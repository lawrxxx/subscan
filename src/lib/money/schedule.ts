// Transfer schedule dates. Pure, UTC calendar dates (yyyy-mm-dd).
import type { TransferSchedule } from "../types.ts";

const DAY = 86_400_000;
export const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => toDate(parse(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);

function monthly(first: string, k: number) {
  const [y, m, d] = first.split("-").map(Number);
  const total = (m - 1) + k;
  const yy = y + Math.floor(total / 12);
  const mm = total % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return toDate(Date.UTC(yy, mm, Math.min(d, last)));
}

/** The n-th date of a schedule (0 = first), or null when it has none. */
export function nth(s: Pick<TransferSchedule, "frequency" | "firstDate">, k: number): string | null {
  if (k < 0) return null;
  if (s.frequency === "once") return k === 0 ? s.firstDate : null;
  if (s.frequency === "weekly") return addDays(s.firstDate, 7 * k);
  return monthly(s.firstDate, k);
}

/** Every date of the schedule within [from, to], respecting the end date. */
export function datesBetween(s: Pick<TransferSchedule, "frequency" | "firstDate" | "endDate">, from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  for (let k = 0; k < cap; k++) {
    const d = nth(s, k);
    if (!d || d > to || (s.endDate && d > s.endDate)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The next date on or after `from`, or null. */
export function nextDate(s: Pick<TransferSchedule, "frequency" | "firstDate" | "endDate">, from: string): string | null {
  for (let k = 0; k < 2000; k++) {
    const d = nth(s, k);
    if (!d || (s.endDate && d > s.endDate)) return null;
    if (d >= from) return d;
  }
  return null;
}

export const FREQ_TEXT: Record<TransferSchedule["frequency"], string> = { once: "Once", weekly: "Every week", monthly: "Every month" };

/** "Every Friday", "On the 1st of every month", "Once on 3 Dec". */
export function describe(s: Pick<TransferSchedule, "frequency" | "firstDate">): string {
  const d = new Date(parse(s.firstDate));
  if (s.frequency === "weekly") return `Every ${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}`;
  if (s.frequency === "monthly") {
    const n = d.getUTCDate();
    const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    return `On the ${n}${suf} of every month`;
  }
  return `Once on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}
