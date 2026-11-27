// Agent tools. Each tool reads the user's actual app state (sent by the client
// with every request) or live chain / Textile FX data. None of them moves funds:
// prepare_payment produces a draft the user must review and approve in the UI.
import { createPublicClient, erc20Abi, formatUnits, http, isAddress } from "viem";
import { CHAIN, RPC_URL, TOKENS, type TokenSymbol } from "../celo/config.ts";

function amt(atomic: string, t: TokenSymbol) {
  return `${Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: t === "cNGN" ? 2 : 4 })} ${TOKENS[t].display}`;
}
import { duplicates, monthlyEquivalent, priceChanges, spendSummary, upcomingRenewals, wasteCandidates, type RateTable } from "../detection/analysis.ts";
import { planPayment } from "../payments/plan.ts";
import { formatRate, preview } from "../textile/client.ts";
import type { AppState, Subscription } from "../types.ts";

export interface ToolContext {
  state: AppState;
  rates: RateTable;
  today: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const chain = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

function brief(s: Subscription) {
  return {
    id: s.id,
    name: s.displayName,
    category: s.category,
    amount: s.amount,
    currency: s.currency,
    frequency: s.frequency,
    monthly_equivalent: Math.round(monthlyEquivalent(s) * 100) / 100,
    next_renewal: s.nextRenewal,
    last_charge: s.lastCharge,
    status: s.status,
    confidence: Math.round(s.confidence * 100) / 100,
    international: s.international,
    price_change: s.priceChange ?? null,
    payment_method: s.payment ? { method: s.payment.method, token: s.payment.token, recipient: s.payment.address ?? s.payment.x402Url } : null,
  };
}

function findSub(state: AppState, ref: unknown): Subscription | undefined {
  const q = String(ref ?? "").toLowerCase().trim();
  if (!q) return undefined;
  return (
    state.subscriptions.find((s) => s.id.toLowerCase() === q) ??
    state.subscriptions.find((s) => s.displayName.toLowerCase() === q) ??
    state.subscriptions.find((s) => s.displayName.toLowerCase().includes(q) || s.merchant.includes(q))
  );
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_subscriptions",
    description:
      "List the user's subscriptions detected from their imported transactions. Use for questions like 'show me all my subscriptions' or to find international (foreign-currency) ones. Dismissed items are excluded unless status='all'.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "confirmed", "detected", "all"], description: "Filter. 'active' = not dismissed." },
        international_only: { type: "boolean", description: "Only subscriptions billed in a currency other than the home currency." },
        sort: { type: "string", enum: ["renewal", "cost"] },
      },
      required: [],
      additionalProperties: false,
    },
    run: async (input, { state }) => {
      const status = (input.status as string) ?? "active";
      let list = state.subscriptions.filter((s) =>
        status === "all" ? true : status === "active" ? s.status !== "dismissed" : s.status === status,
      );
      if (input.international_only) list = list.filter((s) => s.international);
      if (input.sort === "cost") list = [...list].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));
      else list = [...list].sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal));
      return { home_currency: state.settings.homeCurrency, data_source: state.dataSource ?? "none", count: list.length, subscriptions: list.map(brief) };
    },
  },
  {
    name: "get_subscription",
    description: "Get full detail for one subscription by id or name, including charge history and detection reasons.",
    input_schema: { type: "object", properties: { ref: { type: "string", description: "Subscription id or merchant name" } }, required: ["ref"], additionalProperties: false },
    run: async (input, { state }) => {
      const s = findSub(state, input.ref);
      if (!s) return { error: `No subscription matching "${input.ref}"` };
      return { ...brief(s), first_seen: s.firstSeen, charges: s.chargeCount, total_spent: s.totalSpent, history: s.history, detection_reasons: s.confidenceReasons };
    },
  },
  {
    name: "spending_analysis",
    description:
      "Compute recurring spend: monthly and annual totals per currency, total in the home currency when an FX rate is available (rate comes from a live Textile FX quote), spend by category, recent price changes and possible duplicates.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: async (_i, { state, rates }) => {
      const sum = spendSummary(state.subscriptions, state.settings.homeCurrency, rates);
      return {
        ...sum,
        fx_rates_used: rates,
        price_changes: priceChanges(state.subscriptions).map((s) => ({ name: s.displayName, ...s.priceChange, currency: s.currency })),
        possible_duplicates: duplicates(state.subscriptions).map((g) => ({ reason: g.reason, items: g.subscriptions.map((s) => s.displayName) })),
      };
    },
  },
  {
    name: "upcoming_renewals",
    description: "Subscriptions renewing within the next N days, soonest first. Renewal dates are estimates projected from billing history.",
    input_schema: { type: "object", properties: { within_days: { type: "integer", minimum: 1, maximum: 366 } }, required: [], additionalProperties: false },
    run: async (input, { state, today }) => {
      const list = upcomingRenewals(state.subscriptions, today, Number(input.within_days ?? 30));
      return { today, renewals: list.map((s) => ({ ...brief(s), days_until: s.daysUntil })) };
    },
  },
  {
    name: "find_waste",
    description:
      "Identify subscriptions the user might be wasting money on: overlapping/duplicate services, price increases, ones that look lapsed, and large annual renewals. These are flags for the user to decide on, not facts.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: async (_i, { state, rates, today }) => ({ home_currency: state.settings.homeCurrency, flags: wasteCandidates(state.subscriptions, state.settings.homeCurrency, rates, today) }),
  },
  {
    name: "check_wallet_balance",
    description: "Read the connected wallet's live Celo mainnet balances (CELO, USD₮, cNGN). Returns an error if no wallet is connected.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: async (_i, { state }) => {
      const addr = state.settings.wallet;
      if (!addr || !isAddress(addr)) return { error: "No wallet connected. Ask the user to connect a Celo wallet on the Wallet page." };
      const [celo, usdt, cngn] = await Promise.all([
        chain.getBalance({ address: addr }),
        chain.readContract({ address: TOKENS.USDT.address, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
        chain.readContract({ address: TOKENS.cNGN.address, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
      ]);
      return { address: addr, network: "Celo mainnet (42220)", CELO: formatUnits(celo, 18), USDT: formatUnits(usdt, 6), cNGN: formatUnits(cngn, 6) };
    },
  },
  {
    name: "prepare_payment",
    description:
      "Prepare (NOT execute) the next payment for a subscription. Works out the settlement token (NGN→cNGN, USD→USD₮), whether a conversion is needed from the other token, fetches a live indicative Textile FX quote, and checks the wallet balance. The user must open the review screen and approve every transaction themselves. If ref is omitted and international_only is true, picks the next-renewing international subscription.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Subscription id or name" },
        international_only: { type: "boolean" },
        source_token: { type: "string", enum: ["USDT", "cNGN"], description: "Token the user pays from. Defaults to the other token, which requires conversion." },
      },
      required: [],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const { state, today } = ctx;
      let sub = input.ref ? findSub(state, input.ref) : undefined;
      if (!sub) {
        const pool = upcomingRenewals(state.subscriptions, today, 366).filter((s) => (input.international_only ? s.international : true));
        sub = pool[0];
      }
      if (!sub) return { error: input.ref ? `No subscription matching "${input.ref}"` : "No matching upcoming subscription" };
      const plan = planPayment(sub, { sourceToken: input.source_token as "USDT" | "cNGN" | undefined });
      let quote: unknown = null;
      if (plan.destinationToken && plan.sourceToken && plan.needsConversion && plan.destinationAtomic) {
        try {
          const p = await preview({ sellToken: plan.sourceToken, buyToken: plan.destinationToken, buyAmount: plan.destinationAtomic });
          quote =
            p.status === "preview" && p.takerPays && p.buyAmount
              ? {
                  kind: "indicative preview — the firm quote is requested at approval time",
                  pay: amt(p.takerPays, plan.sourceToken),
                  receive: amt(p.buyAmount, plan.destinationToken),
                  fee: p.feeAmount ? amt(p.feeAmount, plan.sourceToken) : null,
                  rate: formatRate(plan.sourceToken, plan.destinationToken, p.takerPays, p.buyAmount),
                  takerPaysAtomic: p.takerPays,
                }
              : { status: p.status, reason: p.reason ?? "no liquidity" };
        } catch (e) {
          quote = { error: `Textile FX quote failed: ${(e as Error).message}` };
        }
      }
      let balance: unknown = null;
      const addr = state.settings.wallet;
      if (addr && plan.sourceToken) {
        try {
          const raw = await chain.readContract({ address: TOKENS[plan.sourceToken].address, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
          const needed = plan.needsConversion
            ? BigInt((quote as { takerPaysAtomic?: string } | null)?.takerPaysAtomic ?? "0")
            : BigInt(plan.destinationAtomic ?? "0");
          balance = { token: plan.sourceToken, available: formatUnits(raw, TOKENS[plan.sourceToken].decimals), sufficient: needed > 0n ? raw >= needed : null };
        } catch (e) {
          balance = { error: (e as Error).message };
        }
      } else balance = { error: "No wallet connected" };
      return {
        draft: true,
        review_url: `/pay/${encodeURIComponent(sub.id)}`,
        subscription: brief(sub),
        plan,
        quote,
        balance,
        steps: plan.needsConversion
          ? ["Approve Textile reactor to spend source token (if allowance is short)", "Convert via Textile FX (firm quote, ~60s validity)", "Settle merchant"]
          : ["Settle merchant"],
      };
    },
  },
  {
    name: "propose_subscription_changes",
    description:
      "Propose status changes to the user's subscriptions: confirm (it is a real subscription), dismiss (not a subscription / not wanted in totals) or restore. Use when the user asks to confirm, dismiss, clean up or tidy their list. The changes are shown to the user with an Apply button; they are not applied until the user clicks it. Pass refs='high_confidence' to target every detected item with confidence >= 0.85.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["confirm", "dismiss", "restore"] },
        refs: { type: "array", items: { type: "string" }, description: "Subscription ids or names, or ['high_confidence']" },
        reason: { type: "string", description: "One short sentence explaining why" },
      },
      required: ["action", "refs"],
      additionalProperties: false,
    },
    run: async (input, { state }) => {
      const action = input.action as "confirm" | "dismiss" | "restore";
      const refs = (input.refs as string[]) ?? [];
      const targets = refs.includes("high_confidence")
        ? state.subscriptions.filter((s) => s.status === "detected" && s.confidence >= 0.85)
        : refs.map((r) => findSub(state, r)).filter((s): s is Subscription => !!s);
      const status = action === "confirm" ? "confirmed" : action === "dismiss" ? "dismissed" : "detected";
      const changes = [...new Map(targets.map((s) => [s.id, s])).values()]
        .filter((s) => s.status !== status)
        .map((s) => ({ id: s.id, name: s.displayName, from: s.status, to: status }));
      const unknown = refs.filter((r) => r !== "high_confidence" && !findSub(state, r));
      return { proposal: true, action, changes, reason: input.reason ?? null, not_found: unknown, note: "Not applied yet — the user must click Apply." };
    },
  },
  {
    name: "transaction_status",
    description: "Look up subscan payment records and their Celo transaction status. Pass a payment id or tx hash, or nothing for the latest payments. Re-checks pending hashes on chain.",
    input_schema: { type: "object", properties: { ref: { type: "string" } }, required: [], additionalProperties: false },
    run: async (input, { state }) => {
      const ref = String(input.ref ?? "").toLowerCase();
      const list = ref
        ? state.payments.filter((p) => p.id.toLowerCase() === ref || p.steps.some((s) => s.hash?.toLowerCase() === ref) || p.merchant.toLowerCase().includes(ref))
        : state.payments.slice(0, 5);
      const out = await Promise.all(
        list.map(async (p) => ({
          id: p.id,
          merchant: p.merchant,
          created: p.createdAt,
          status: p.status,
          steps: await Promise.all(
            p.steps.map(async (s) => {
              if (!s.hash) return s;
              try {
                const r = await chain.getTransactionReceipt({ hash: s.hash });
                return { ...s, onchain: r.status === "success" ? "confirmed" : "failed", block: r.blockNumber.toString() };
              } catch {
                return { ...s, onchain: "not yet mined or not found" };
              }
            }),
          ),
        })),
      );
      return { payments: out, note: out.length ? undefined : "No payments recorded yet." };
    },
  },
];

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}
