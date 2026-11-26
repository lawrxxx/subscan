// Payment planning: decides what must be converted and settled for a given
// subscription. Pure logic — quoting and execution live elsewhere.
import { parseUnits } from "viem";
import { TOKENS, tokenForCurrency, type TokenSymbol } from "../celo/config.ts";
import type { Subscription } from "../types.ts";

export interface PaymentPlan {
  ok: boolean;
  problems: string[];
  subscriptionId: string;
  merchant: string;
  amount: number;
  currency: string;
  destinationToken?: TokenSymbol;
  destinationAtomic?: string;
  sourceToken?: TokenSymbol;
  needsConversion: boolean;
  method?: "address" | "x402";
  recipient?: string;
  x402Url?: string;
}

export function otherToken(t: TokenSymbol): TokenSymbol {
  return t === "USDT" ? "cNGN" : "USDT";
}

export function planPayment(sub: Subscription, opts: { sourceToken?: TokenSymbol } = {}): PaymentPlan {
  const problems: string[] = [];
  const destinationToken = sub.payment?.token ?? tokenForCurrency(sub.currency);
  if (!destinationToken) problems.push(`No supported Celo stablecoin for ${sub.currency}. Supported: NGN (cNGN), USD (USD₮).`);
  if (!sub.payment) problems.push("No verified merchant payment method. Add the merchant's Celo receiving address or x402 endpoint first.");
  else if (sub.payment.method === "address" && !sub.payment.address) problems.push("Merchant receiving address missing.");
  else if (sub.payment.method === "x402" && !sub.payment.x402Url) problems.push("x402 endpoint missing.");
  if (sub.status === "dismissed") problems.push("This subscription was dismissed.");

  const plan: PaymentPlan = {
    ok: false,
    problems,
    subscriptionId: sub.id,
    merchant: sub.displayName,
    amount: sub.amount,
    currency: sub.currency,
    destinationToken,
    needsConversion: false,
    method: sub.payment?.method,
    recipient: sub.payment?.address,
    x402Url: sub.payment?.x402Url,
  };
  if (destinationToken) {
    plan.destinationAtomic = parseUnits(sub.amount.toFixed(TOKENS[destinationToken].decimals), TOKENS[destinationToken].decimals).toString();
    plan.sourceToken = opts.sourceToken ?? otherToken(destinationToken);
    plan.needsConversion = plan.sourceToken !== destinationToken;
  }
  plan.ok = problems.length === 0;
  return plan;
}
