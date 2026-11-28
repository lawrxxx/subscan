// Safety checks every automated movement of money must pass. Pure functions:
// the server runs them before signing; the browser runs the same ones to explain
// what will happen. A check is never enforced in one place and forgotten in another.
import type { TokenSymbol } from "../celo/config.ts";

export interface ApprovedRecipient {
  address: `0x${string}`;
  label: string;
}

export type Refusal =
  | "access_missing"
  | "access_expired"
  | "key_not_authorized"
  | "recipient_not_approved"
  | "over_transfer_limit"
  | "over_monthly_limit"
  | "insufficient_funds"
  | "route_unavailable"
  | "needs_renewal"
  | "invalid_amount"
  | "over_rule_max"
  | "already_done";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  access_missing: "subscan doesn't have access to your payment wallet yet.",
  access_expired: "subscan's access to your payment wallet has expired. Renew it in Settings.",
  key_not_authorized: "Your payment wallet doesn't currently allow subscan to move money.",
  recipient_not_approved: "This recipient isn't one of your saved, confirmed recipients.",
  over_transfer_limit: "This is above your limit for a single automated transfer.",
  over_monthly_limit: "This would go over your monthly limit.",
  insufficient_funds: "There isn't enough money in your payment wallet.",
  route_unavailable: "Textile FX can't convert this right now.",
  needs_renewal: "Your current access doesn't cover this kind of conversion. Renew access in Settings.",
  invalid_amount: "The amount isn't valid.",
  over_rule_max: "The live quote costs more than this rule's maximum, so nothing was converted.",
  already_done: "This was already sent.",
};

export interface CheckContext {
  now: number; // unix seconds
  expiry: number; // access expiry, unix seconds
  keyAuthorized: boolean; // read from the wallet contract on-chain
  /** Largest single automated movement per token (atomic), from the sealed policy. */
  maxPerTransfer: Partial<Record<TokenSymbol, bigint>>;
  /** Remaining monthly allowance per token, from the wallet's own spend record. */
  remaining: Record<TokenSymbol, bigint>;
  balances: Record<TokenSymbol, bigint>;
  alreadyDone: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function common(ctx: CheckContext, token: TokenSymbol, amount: bigint): Refusal[] {
  const out: Refusal[] = [];
  if (amount <= 0n) out.push("invalid_amount");
  if (ctx.expiry <= ctx.now) out.push("access_expired");
  if (!ctx.keyAuthorized) out.push("key_not_authorized");
  const max = ctx.maxPerTransfer[token];
  if (max !== undefined && amount > max) out.push("over_transfer_limit");
  if (amount > ctx.remaining[token]) out.push("over_monthly_limit");
  if (amount > ctx.balances[token]) out.push("insufficient_funds");
  if (ctx.alreadyDone) out.push("already_done");
  return out;
}

/** A transfer to a saved recipient. Returns every refusal, not just the first. */
export function checkTransfer(req: { token: TokenSymbol; amount: bigint; recipient: `0x${string}` }, recipients: ApprovedRecipient[], ctx: CheckContext): Refusal[] {
  const out = common(ctx, req.token, req.amount);
  if (!recipients.some((r) => same(r.address, req.recipient))) out.push("recipient_not_approved");
  return out;
}

/** A conversion inside the payment wallet. `sellAmount` is what the live quote says it costs. */
export function checkConversion(req: { sellToken: TokenSymbol; sellAmount: bigint; routeOk: boolean; templateOk: boolean }, ctx: CheckContext): Refusal[] {
  const out = common(ctx, req.sellToken, req.sellAmount);
  if (!req.templateOk) out.push("needs_renewal");
  if (!req.routeOk) out.push("route_unavailable");
  return out;
}
