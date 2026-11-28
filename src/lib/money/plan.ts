// The planner: given the user's data, today's date and real balances, what should
// happen now? Pure and deterministic, so the same inputs always give the same plan.
import type { TokenSymbol } from "../celo/config.ts";
import type { Activity, AppState, MoneyRule, Recipient, TransferSchedule } from "../types.ts";
import { evaluateRule, transferCap, type Balances, type RuleNeed } from "./rules.ts";
import { daysBetween, datesBetween, nextDate } from "./schedule.ts";
import { tokensFor } from "./destinations.ts";

/** A missed transfer is still sent automatically if it's at most this many days late. */
export const GRACE_DAYS = 3;
/** A rule converts at most once per window. */
export const RULE_WINDOW_HOURS = 6;

export type Step =
  | { type: "send"; key: string; schedule: TransferSchedule; recipient: Recipient; date: string; token: TokenSymbol; amount: string }
  | { type: "ask"; key: string; schedule: TransferSchedule; recipient: Recipient; date: string; token: TokenSymbol; amount: string; why: string }
  | { type: "block"; key: string; schedule: TransferSchedule; recipient?: Recipient; date: string; token: TokenSymbol; amount: string; why: string; end?: boolean }
  | { type: "convert"; key: string; rule: MoneyRule; need: Extract<RuleNeed, { kind: "convert" }> }
  | { type: "ask_convert"; key: string; rule: MoneyRule; need: Extract<RuleNeed, { kind: "convert" }> }
  | { type: "end"; schedule: TransferSchedule; why: string };

export const scheduleKey = (id: string, date: string) => `schedule:${id}:${date}`;
export function ruleKey(id: string, nowMs: number) {
  const w = Math.floor(nowMs / (RULE_WINDOW_HOURS * 3_600_000));
  return `rule:${id}:${w}`;
}

const num = (s?: string) => (s && Number.isFinite(Number(s)) ? Number(s) : 0);
/** Sent (or in flight) so far for a schedule. Failed and cancelled ones don't count. */
export function sentTotal(activity: Activity[], scheduleId: string) {
  return activity.filter((a) => a.scheduleId === scheduleId && (a.status === "completed" || a.status === "processing")).reduce((x, a) => x + num(a.amount), 0);
}

/** Has this key been handled (any record other than a retried failure)? */
function handled(activity: Activity[], key: string) {
  return activity.some((a) => a.key === key || a.key.startsWith(`${key}:retry`));
}

export function plan(state: AppState, input: { today: string; nowMs: number; balances: Balances | null; ngnPerUsd: number | null }): Step[] {
  const steps: Step[] = [];
  const { today } = input;

  for (const s of state.schedules) {
    if (s.status !== "active") continue;
    const recipient = state.recipients.find((r) => r.id === s.recipientId);
    // Past its end date with nothing left to send.
    if (s.endDate && s.endDate < today && !datesBetween(s, today, today).length && !nextDate(s, today)) {
      const due = datesBetween(s, s.firstDate, s.endDate).filter((d) => !handled(state.activity, scheduleKey(s.id, d)));
      if (!due.length) {
        steps.push({ type: "end", schedule: s, why: "Reached its end date." });
        continue;
      }
    }
    let total = sentTotal(state.activity, s.id);
    for (const date of datesBetween(s, s.firstDate, today)) {
      const key = scheduleKey(s.id, date);
      if (handled(state.activity, key)) continue;
      const base = { key, schedule: s, recipient, date, token: s.token, amount: s.amount };
      const amount = num(s.amount);
      const cap = transferCap(state.rules, s.token);
      const limit = num(s.txLimit) || undefined;
      if (!recipient?.confirmedAt) {
        steps.push({ ...base, type: "block", why: "The recipient hasn't been confirmed." });
        continue;
      }
      if (!tokensFor(recipient).includes(s.token)) {
        steps.push({ ...base, type: "block", why: `${recipient.name}'s destination isn't known to accept this token on Celo.` });
        continue;
      }
      if (limit !== undefined && amount > limit) {
        steps.push({ ...base, type: "block", why: "This is above the schedule's limit for one transfer." });
        continue;
      }
      if (cap !== undefined && amount > cap) {
        steps.push({ ...base, type: "block", why: `A money rule caps automated transfers at ${cap.toLocaleString("en-US")} ${s.token === "USDT" ? "USD₮" : "cNGN"}.` });
        continue;
      }
      if (s.maxTotal && total + amount > num(s.maxTotal) + 1e-9) {
        steps.push({ ...base, type: "block", why: "This would go over the schedule's maximum total, so the schedule has ended.", end: true });
        break;
      }
      const late = daysBetween(date, today);
      if (late > GRACE_DAYS) steps.push({ ...base, recipient, type: "ask", why: `This was due ${late} days ago, while subscan wasn't open. Send it now?` });
      else {
        steps.push({ ...base, recipient, type: "send" });
        total += amount;
      }
    }
    if (s.frequency === "once" && s.firstDate < today && handled(state.activity, scheduleKey(s.id, s.firstDate))) steps.push({ type: "end", schedule: s, why: "One-off transfer done." });
  }

  if (input.balances) {
    for (const r of state.rules) {
      if (r.status !== "active" || r.kind === "transfer_cap") continue;
      const need = evaluateRule(r, input.balances, input.ngnPerUsd);
      if (need.kind !== "convert") continue;
      // Don't stack: one open conversion per rule.
      if (state.activity.some((a) => a.ruleId === r.id && (a.status === "processing" || a.status === "awaiting_approval"))) continue;
      const key = ruleKey(r.id, input.nowMs);
      if (handled(state.activity, key)) continue;
      steps.push({ type: r.askFirst ? "ask_convert" : "convert", key, rule: r, need });
    }
  }
  return steps;
}

export interface Upcoming {
  schedule: TransferSchedule;
  recipient?: Recipient;
  date: string;
}

/** The next dates across active schedules, soonest first. */
export function upcoming(state: AppState, today: string, limit = 10): Upcoming[] {
  const out: Upcoming[] = [];
  for (const s of state.schedules) {
    if (s.status !== "active" && s.status !== "paused") continue;
    let from = today;
    for (let i = 0; i < 3; i++) {
      const d = nextDate(s, from);
      if (!d) break;
      if (!handled(state.activity, scheduleKey(s.id, d))) out.push({ schedule: s, recipient: state.recipients.find((r) => r.id === s.recipientId), date: d });
      from = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}
