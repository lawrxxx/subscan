// Money rules: what each rule wants right now, from real balances. Pure.
// Sizing may use Textile's live indicative rate; execution always uses a firm
// quote, and the server re-checks the rule's maximum against that quote.
import type { TokenSymbol } from "../celo/config.ts";
import type { MoneyRule } from "../types.ts";

export type Balances = Record<TokenSymbol, number>;

export type RuleNeed =
  | { kind: "none"; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "convert"; sellToken: TokenSymbol; buyToken: TokenSymbol; buyAmount?: number; sellAmount?: number; maxSell?: number; reason: string };

export const other = (t: TokenSymbol): TokenSymbol => (t === "USDT" ? "cNGN" : "USDT");
const n = (s?: string) => (s && Number.isFinite(Number(s)) ? Number(s) : 0);
const fmt = (v: number, t: TokenSymbol) => `${v.toLocaleString("en-US", { maximumFractionDigits: t === "USDT" ? 2 : 0 })} ${t === "USDT" ? "USD₮" : "cNGN"}`;
/** Value of an amount in USD₮ terms, using NGN per USD. */
const usd = (v: number, t: TokenSymbol, ngnPerUsd: number) => (t === "USDT" ? v : v / ngnPerUsd);

/** Reserve rules leave this much slack (percentage points) so they don't flip-flop. */
export const RESERVE_BAND = 2;

export function evaluateRule(rule: MoneyRule, bal: Balances, ngnPerUsd: number | null): RuleNeed {
  if (rule.status !== "active") return { kind: "none", reason: "Paused." };
  const from = rule.fromToken ?? other(rule.token);
  const have = bal[rule.token];
  const max = n(rule.maxAmount) || undefined;
  switch (rule.kind) {
    case "transfer_cap":
      return { kind: "none", reason: `Automated ${rule.token === "USDT" ? "USD₮" : "cNGN"} transfers are capped at ${fmt(n(rule.amount), rule.token)}.` };
    case "keep_min": {
      const min = n(rule.amount);
      if (have >= min) return { kind: "none", reason: `You have ${fmt(have, rule.token)}, at or above ${fmt(min, rule.token)}.` };
      const deficit = min - have;
      if (bal[from] <= 0) return { kind: "wait", reason: `Below ${fmt(min, rule.token)}, but there's no ${from === "USDT" ? "USD₮" : "cNGN"} to convert from.` };
      return { kind: "convert", sellToken: from, buyToken: rule.token, buyAmount: deficit, maxSell: max, reason: `${fmt(have, rule.token)} is below ${fmt(min, rule.token)}: top up ${fmt(deficit, rule.token)}.` };
    }
    case "convert_below": {
      const min = n(rule.amount);
      const amt = n(rule.convertAmount);
      if (have >= min) return { kind: "none", reason: `You have ${fmt(have, rule.token)}, at or above ${fmt(min, rule.token)}.` };
      if (amt <= 0) return { kind: "wait", reason: "No conversion amount set." };
      if (bal[from] < amt) return { kind: "wait", reason: `Below ${fmt(min, rule.token)}, but there's only ${fmt(bal[from], from)} to convert.` };
      return { kind: "convert", sellToken: from, buyToken: rule.token, sellAmount: amt, maxSell: max ?? amt, reason: `${fmt(have, rule.token)} is below ${fmt(min, rule.token)}: convert ${fmt(amt, from)}.` };
    }
    case "reserve_share": {
      const pct = rule.sharePct ?? 0;
      if (!(pct > 0 && pct < 100)) return { kind: "wait", reason: "Set a share between 1% and 99%." };
      if (!ngnPerUsd) return { kind: "wait", reason: "Waiting for a live rate from Textile FX." };
      const total = usd(bal.USDT, "USDT", ngnPerUsd) + usd(bal.cNGN, "cNGN", ngnPerUsd);
      if (total <= 0) return { kind: "none", reason: "Your payment wallet is empty." };
      const share = (usd(have, rule.token, ngnPerUsd) / total) * 100;
      if (share >= pct - RESERVE_BAND) return { kind: "none", reason: `${Math.round(share)}% is in ${rule.token === "USDT" ? "USD₮" : "cNGN"} (target ${pct}%).` };
      const gapUsd = (total * pct) / 100 - usd(have, rule.token, ngnPerUsd);
      const sell = from === "USDT" ? gapUsd : gapUsd * ngnPerUsd;
      const capped = max ? Math.min(sell, max) : sell;
      return { kind: "convert", sellToken: from, buyToken: rule.token, sellAmount: capped, maxSell: max ?? capped, reason: `Only ${Math.round(share)}% is in ${rule.token === "USDT" ? "USD₮" : "cNGN"} (target ${pct}%): convert about ${fmt(capped, from)}.` };
    }
  }
}

/** Lowest active "never above" cap for automated transfers of a token, if any. */
export function transferCap(rules: MoneyRule[], token: TokenSymbol): number | undefined {
  const caps = rules.filter((r) => r.kind === "transfer_cap" && r.status === "active" && r.token === token).map((r) => n(r.amount)).filter((v) => v > 0);
  return caps.length ? Math.min(...caps) : undefined;
}

export const KIND_TEXT: Record<MoneyRule["kind"], { title: string; example: string }> = {
  keep_min: { title: "Keep a minimum balance", example: "Keep at least 50,000 cNGN in my wallet" },
  convert_below: { title: "Convert when low", example: "Convert 20 USD₮ to cNGN when cNGN falls below 10,000" },
  reserve_share: { title: "Keep a share in one currency", example: "Keep 30% of my money in USD₮" },
  transfer_cap: { title: "Limit automated transfers", example: "Never send more than 5,000 cNGN in one automated transfer" },
};

/** One-line plain description of a rule. */
export function ruleSummary(r: MoneyRule): string {
  const from = r.fromToken ?? other(r.token);
  switch (r.kind) {
    case "keep_min":
      return `Keep at least ${fmt(n(r.amount), r.token)}, topping up from ${from === "USDT" ? "USD₮" : "cNGN"}`;
    case "convert_below":
      return `Convert ${fmt(n(r.convertAmount), from)} to ${r.token === "USDT" ? "USD₮" : "cNGN"} when it falls below ${fmt(n(r.amount), r.token)}`;
    case "reserve_share":
      return `Keep at least ${r.sharePct}% of my money in ${r.token === "USDT" ? "USD₮" : "cNGN"}`;
    case "transfer_cap":
      return `Never send more than ${fmt(n(r.amount), r.token)} in one automated transfer`;
  }
}
