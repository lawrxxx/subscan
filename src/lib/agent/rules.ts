// subscan's agent: deterministic rules, no language model.
// For every confirmed regular payment it decides what should happen next and
// says why, in plain words. Payments it decides to make go through Altana
// (wallet, session permissions, execution); conversions go through Textile FX.
// The server re-checks the on-chain rules (key authorised, remaining monthly
// allowance, balance) before anything is sent.
import { parseUnits } from "viem";
import { TOKENS, tokenForCurrency, type TokenSymbol } from "../celo/config.ts";
import { idempotencyKey } from "../payments/engine.ts";
import { predictedNext } from "../review.ts";
import type { AppState } from "../types.ts";

const DAY = 86_400_000;
/** Pay when the bill is due within this many days… */
export const PAY_WINDOW_DAYS = 2;
/** …or overdue by no more than this many (after that, the user decides). */
export const OVERDUE_LIMIT_DAYS = 7;
/** Tell the user this many days ahead about anything that needs them. */
export const NOTICE_DAYS = 7;

export type Decision =
  | "pay" // eligible now: the runner asks the server to pay it
  | "scheduled" // eligible, not due yet
  | "needs_you" // the user must act (set up, approve, renew, switch on)
  | "blocked" // a rule stops it (limit, paused)
  | "paid" // already paid for this due date
  | "manual" // no digital payment details: the user pays it themselves
  | "no_date"; // not enough history to know when it's due

export interface AgentDecision {
  billId: string;
  name: string;
  amount: number;
  currency: string;
  token?: TokenSymbol;
  dueDate?: string;
  daysUntil?: number;
  decision: Decision;
  reasons: string[];
  /** The one thing the user can do about it, when there is one. */
  action?: { label: string; href: string };
}

export function decide(state: AppState, now = Date.now()): AgentDecision[] {
  const ap = state.autopilot;
  const nowSec = now / 1000;
  const access = !ap?.sealedPolicy ? "none" : ap.revokedAt ? "revoked" : (ap.expiry ?? 0) <= nowSec ? "expired" : "active";
  const bills = state.subscriptions.filter((s) => (s.status === "confirmed" || s.manual) && s.status !== "dismissed" && !s.lapsed);

  return bills
    .map((s): AgentDecision => {
      const base = { billId: s.id, name: s.displayName, amount: s.amount, currency: s.currency };
      const due = predictedNext(s);
      if (!due) return { ...base, decision: "no_date", reasons: ["Not enough payment history to know when it's next due."] };
      const daysUntil = Math.round((Date.parse(`${due}T00:00:00Z`) - now) / DAY);
      const token = s.payment?.token ?? tokenForCurrency(s.currency);
      const withDue = { ...base, dueDate: due, daysUntil, token };
      const page = `/payments/${encodeURIComponent(s.id)}`;

      if (!s.payment?.address || !token) return { ...withDue, decision: "manual", reasons: ["No wallet address for this provider, so you pay it yourself."], action: { label: "Add payment details", href: page } };

      const idem = ap ? idempotencyKey(ap.wallet, { billId: s.id, dueDate: due }) : "";
      if (ap && state.payments.some((p) => p.idempotencyKey === idem && p.status === "confirmed")) return { ...withDue, decision: "paid", reasons: [`Paid for ${due}.`] };

      const reasons: string[] = [];
      let decision: Decision = daysUntil <= PAY_WINDOW_DAYS && -daysUntil <= OVERDUE_LIMIT_DAYS ? "pay" : "scheduled";
      let action: AgentDecision["action"];
      const need = (why: string, a: AgentDecision["action"]) => {
        reasons.push(why);
        decision = "needs_you";
        action ??= a;
      };

      if (-daysUntil > OVERDUE_LIMIT_DAYS) need(`Overdue by ${-daysUntil} days. Check with the provider before paying.`, { label: "Open bill", href: page });
      if (access === "none") need("Autopilot isn't set up.", { label: "Set up Autopilot", href: "/autopilot" });
      else if (access === "revoked") need("You revoked subscan's payment access.", { label: "Give access again", href: "/autopilot" });
      else if (access === "expired") need("subscan's payment access has expired.", { label: "Renew access", href: "/autopilot" });
      else {
        if (!ap!.recipients.some((r) => r.address.toLowerCase() === s.payment!.address!.toLowerCase())) need("This recipient isn't on your approved list.", { label: "Approve recipient", href: "/autopilot" });
        if (!s.autopay) need("Automatic payment is off for this bill.", { label: "Switch on Auto", href: page });
        if ((ap!.expiry ?? 0) < Date.parse(`${due}T00:00:00Z`) / 1000) need("Access expires before this is due.", { label: "Renew access", href: "/autopilot" });
        const limit = parseUnits(ap!.limits[token] || "0", TOKENS[token].decimals);
        const amt = parseUnits(s.amount.toFixed(TOKENS[token].decimals), TOKENS[token].decimals);
        if ((decision as Decision) !== "needs_you") {
          if (amt > limit) {
            decision = "blocked";
            reasons.push(`More than your monthly ${TOKENS[token].display} limit (${ap!.limits[token]}).`);
            action = { label: "Change limits", href: "/autopilot" };
          } else if (!ap!.enabled) {
            decision = "blocked";
            reasons.push("Autopilot is paused.");
            action = { label: "Turn on", href: "/autopilot" };
          }
        }
      }
      if (decision === "pay") reasons.push("Due now and within your limits. The wallet's balance and remaining allowance are checked on Celo before paying.");
      if (decision === "scheduled") reasons.push(`Will be paid automatically around ${due}.`);
      return { ...withDue, decision, reasons, action };
    })
    .sort((a, b) => (a.daysUntil ?? 9e9) - (b.daysUntil ?? 9e9));
}

/** Decisions the user should hear about now: anything needing them or blocked within the notice window. */
export function notices(ds: AgentDecision[]) {
  return ds.filter((d) => (d.decision === "needs_you" || d.decision === "blocked") && (d.daysUntil ?? 9e9) <= NOTICE_DAYS);
}
