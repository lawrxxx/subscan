// Shared payment engine: the stages a payment moves through and the checks every
// autonomous payment must pass. Pure functions: the manual pay page, the
// Autopilot server route and the agent all use these, so a rule is never
// enforced in one place and forgotten in another.
import { TOKENS, type TokenSymbol } from "../celo/config.ts";

export type Stage = "detected" | "prepared" | "quoted" | "converted" | "submitted" | "confirmed" | "failed";
export const STAGE_LABEL: Record<Stage, string> = {
  detected: "Payment found",
  prepared: "Payment prepared",
  quoted: "Conversion quoted",
  converted: "Conversion done",
  submitted: "Payment sent",
  confirmed: "Payment confirmed",
  failed: "Payment failed",
};

export interface ApprovedRecipient {
  address: `0x${string}`;
  label: string;
  /** The bill this recipient was verified for. */
  billId?: string;
}

export interface AutopayRequest {
  billId: string;
  billName: string;
  recipient: `0x${string}`;
  token: TokenSymbol; // what the recipient must receive
  amountAtomic: bigint; // in `token` units
  /** Idempotency: one payment per bill per due date. */
  dueDate: string;
}

export interface AutopayContext {
  now: number; // unix seconds
  enabled: boolean;
  expiry: number; // session expiry, unix seconds
  revoked: boolean;
  keyAuthorized: boolean; // read from the account on-chain
  recipients: ApprovedRecipient[];
  /** Remaining monthly allowance per token, from the account's own spend record. */
  remaining: Record<TokenSymbol, bigint>;
  balances: Record<TokenSymbol, bigint>;
  /** Source token chosen to fund the payment, and how much of it is needed (incl. conversion). */
  source: TokenSymbol;
  sourceNeeded: bigint;
  conversionAvailable: boolean;
  alreadyPaid: boolean;
}

export type Refusal =
  | "autopilot_off"
  | "access_expired"
  | "access_revoked"
  | "key_not_authorized"
  | "recipient_not_approved"
  | "over_limit"
  | "insufficient_funds"
  | "route_unavailable"
  | "invalid_amount"
  | "already_paid";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  autopilot_off: "Automatic payments are turned off.",
  access_expired: "subscan's payment access has expired. Renew it in Autopilot.",
  access_revoked: "You revoked subscan's payment access.",
  key_not_authorized: "Your Autopilot wallet doesn't currently authorise subscan.",
  recipient_not_approved: "This recipient isn't on your approved list.",
  over_limit: "This would go over your monthly payment limit.",
  insufficient_funds: "There isn't enough money in your Autopilot wallet.",
  route_unavailable: "There's no live conversion for this amount right now.",
  invalid_amount: "The amount isn't valid.",
  already_paid: "This bill was already paid for this due date.",
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Every condition for an autonomous payment. Returns all refusals, not just the
 * first, so the user sees everything that needs fixing. An empty list means go.
 */
export function checkAutopay(req: AutopayRequest, ctx: AutopayContext): Refusal[] {
  const out: Refusal[] = [];
  if (!ctx.enabled) out.push("autopilot_off");
  if (ctx.revoked) out.push("access_revoked");
  else if (ctx.now >= ctx.expiry) out.push("access_expired");
  else if (!ctx.keyAuthorized) out.push("key_not_authorized");
  if (req.amountAtomic <= 0n) out.push("invalid_amount");
  if (!ctx.recipients.some((r) => same(r.address, req.recipient))) out.push("recipient_not_approved");
  if (ctx.alreadyPaid) out.push("already_paid");
  if (req.token !== ctx.source && !ctx.conversionAvailable) out.push("route_unavailable");
  if (ctx.sourceNeeded > ctx.remaining[ctx.source]) out.push("over_limit");
  if (ctx.sourceNeeded > ctx.balances[ctx.source]) out.push("insufficient_funds");
  return out;
}

export function idempotencyKey(wallet: string, req: Pick<AutopayRequest, "billId" | "dueDate">) {
  return `${wallet.toLowerCase()}|${req.billId}|${req.dueDate}`;
}

export function human(atomic: bigint, t: TokenSymbol) {
  const d = TOKENS[t].decimals;
  const s = atomic.toString().padStart(d + 1, "0");
  const whole = s.slice(0, -d);
  const frac = s.slice(-d).replace(/0+$/, "").slice(0, 2);
  return `${Number(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""} ${TOKENS[t].display}`;
}
