// Agent tools. Each tool reads the user's actual app state (sent by the client
// with every request) or live chain / Textile FX data. None of them moves funds:
// prepare_payment produces a draft the user must review and approve in the UI.
import { createPublicClient, erc20Abi, formatUnits, http, isAddress } from "viem";
import { CHAIN, RPC_URL, TOKENS, type TokenSymbol } from "../celo/config.ts";

function amt(atomic: string, t: TokenSymbol) {
  return `${Number(formatUnits(BigInt(atomic), TOKENS[t].decimals)).toLocaleString("en-US", { maximumFractionDigits: t === "cNGN" ? 2 : 4 })} ${TOKENS[t].display}`;
}
import { commitments, dueBefore, duplicates, income, monthlyEquivalent, priceChanges, savingsPotential, spendSummary, toHome, upcomingRenewals, wasteCandidates, type RateTable } from "../detection/analysis.ts";
import { classify } from "../detection/merchants.ts";
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
    type: s.kind ?? "subscription",
    category: s.category,
    bill_type: s.billType ?? "fixed",
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
    expected_payment_missing: s.missed?.expected ?? null,
    unusual_charge: s.unusual ?? null,
    lapsed: !!s.lapsed,
    added_by_user: !!s.manual,
    payment_method: s.payment ? { method: s.payment.method, token: s.payment.token, recipient: s.payment.address ?? s.payment.x402Url } : null,
  };
}

function findSub(state: AppState, ref: unknown): Subscription | undefined {
  const q = String(ref ?? "").toLowerCase().trim();
  if (!q) return undefined;
  return (
    state.subscriptions.find((s) => s.id.toLowerCase() === q) ??
    state.subscriptions.find((s) => s.displayName.toLowerCase() === q) ??
    state.subscriptions.find((s) => s.displayName.toLowerCase().includes(q) || s.merchant.includes(q)) ??
    // "electricity", "internet", "rent" … match by category
    state.subscriptions.find((s) => s.status !== "dismissed" && (s.category.toLowerCase() === q || q.includes(s.category.toLowerCase())))
  );
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_subscriptions",
    description:
      "List the user's recurring bills: subscriptions, utilities (electricity, internet, mobile, water) and other obligations (rent, insurance, loans), detected from imported statements or added by the user. Filter by type. Dismissed items are excluded unless status='all'.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "confirmed", "detected", "all"], description: "Filter. 'active' = not dismissed." },
        international_only: { type: "boolean", description: "Only bills charged in a currency other than the home currency." },
        type: { type: "string", enum: ["subscription", "utility", "obligation", "all"] },
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
      if (input.type && input.type !== "all") list = list.filter((s) => (s.kind ?? "subscription") === input.type);
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
      "Propose changes to the user's bills: confirm (it is a real recurring bill), dismiss (not a bill / not wanted in totals), restore, or categorise (set type, category and/or fixed-vs-variable). Use when the user asks to confirm, dismiss, tidy or re-categorise. Changes are shown with an Apply button and are NOT applied until the user clicks it. Pass refs=['high_confidence'] to target every detected item with confidence >= 0.85.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["confirm", "dismiss", "restore", "categorise"] },
        type: { type: "string", enum: ["subscription", "utility", "obligation"], description: "categorise only" },
        category: { type: "string", description: "categorise only, e.g. Electricity, Internet, Rent, Streaming" },
        bill_type: { type: "string", enum: ["fixed", "variable"], description: "categorise only" },
        refs: { type: "array", items: { type: "string" }, description: "Subscription ids or names, or ['high_confidence']" },
        reason: { type: "string", description: "One short sentence explaining why" },
      },
      required: ["action", "refs"],
      additionalProperties: false,
    },
    run: async (input, { state }) => {
      const action = input.action as "confirm" | "dismiss" | "restore" | "categorise";
      const refs = (input.refs as string[]) ?? [];
      if (action === "categorise") {
        const patch: Record<string, unknown> = { edited: true };
        if (input.type) patch.kind = input.type;
        if (input.category) patch.category = String(input.category).slice(0, 40);
        if (input.bill_type) patch.billType = input.bill_type;
        const targets = refs.map((r) => findSub(state, r)).filter((s): s is Subscription => !!s);
        const label = [input.type, input.category, input.bill_type].filter(Boolean).join(" · ");
        return {
          proposal: true,
          action,
          changes: targets.map((s) => ({ id: s.id, name: s.displayName, from: `${s.kind ?? "subscription"} · ${s.category} · ${s.billType ?? "fixed"}`, to: label, patch })),
          reason: input.reason ?? null,
          not_found: refs.filter((r) => !findSub(state, r)),
          note: "Not applied yet — the user must click Apply.",
        };
      }
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
    name: "search_transactions",
    description:
      "Search the user's imported bank/card transactions (date, description, amount, money in/out). Use to answer 'when did I pay X', 'show my transfers to Y', or to check a specific charge. Returns at most 50 rows plus totals.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find in the description (case-insensitive)" },
        direction: { type: "string", enum: ["debit", "credit", "any"] },
        from: { type: "string", description: "yyyy-mm-dd" },
        to: { type: "string", description: "yyyy-mm-dd" },
        min_amount: { type: "number" },
      },
      required: [],
      additionalProperties: false,
    },
    run: async (input, { state }) => {
      const q = String(input.query ?? "").toLowerCase().trim();
      const dir = (input.direction as string) ?? "any";
      const list = state.transactions.filter(
        (t) =>
          (!q || t.description.toLowerCase().includes(q)) &&
          (dir === "any" || (t.direction ?? "debit") === dir) &&
          (!input.from || t.date >= String(input.from)) &&
          (!input.to || t.date <= String(input.to)) &&
          (!input.min_amount || t.amount >= Number(input.min_amount)),
      );
      const out = list.filter((t) => (t.direction ?? "debit") === "debit").reduce((x, t) => x + t.amount, 0);
      const inn = list.filter((t) => t.direction === "credit").reduce((x, t) => x + t.amount, 0);
      return {
        matches: list.length,
        total_out: Math.round(out * 100) / 100,
        total_in: Math.round(inn * 100) / 100,
        transactions: list.slice(-50).reverse().map((t) => ({ date: t.date, description: t.description, amount: t.amount, currency: t.currency, direction: t.direction ?? "debit" })),
        note: state.transactions.length ? undefined : "No transactions imported.",
      };
    },
  },
  {
    name: "spending_breakdown",
    description:
      "Where the user's money goes: all money out over the statement period grouped by category and top payees, split into committed (recurring bills) vs everything else. Use for 'where is my money going' or 'analyse my statement'.",
    input_schema: { type: "object", properties: { months: { type: "integer", minimum: 1, maximum: 24, description: "Look back this many months (default: whole statement)" } }, required: [], additionalProperties: false },
    run: async (input, { state, today }) => {
      const home = state.settings.homeCurrency;
      const since = input.months ? new Date(Date.parse(today) - Number(input.months) * 30.44 * 86_400_000).toISOString().slice(0, 10) : "";
      const debits = state.transactions.filter((t) => (t.direction ?? "debit") === "debit" && t.currency === home && t.date >= since);
      const recurring = new Set(state.subscriptions.filter((s) => s.status !== "dismissed").map((s) => s.merchant));
      const byCat = new Map<string, number>();
      const byPayee = new Map<string, number>();
      let committed = 0;
      for (const t of debits) {
        const c = classify(t.description);
        const isBill = recurring.has(t.merchant);
        if (isBill) committed += t.amount;
        const cat = isBill ? c.category : c.category === "Other" ? "Everyday spending & transfers" : c.category;
        byCat.set(cat, (byCat.get(cat) ?? 0) + t.amount);
        byPayee.set(t.merchant, (byPayee.get(t.merchant) ?? 0) + t.amount);
      }
      const total = debits.reduce((x, t) => x + t.amount, 0);
      const dates = debits.map((t) => t.date).sort();
      const months = dates.length ? Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 / 30.44) : 1;
      const r = (n: number) => Math.round(n);
      return {
        currency: home,
        period: dates.length ? { from: dates[0], to: dates[dates.length - 1], months: Math.round(months * 10) / 10 } : null,
        total_out: r(total),
        monthly_average_out: r(total / months),
        recurring_bills_share: total ? Math.round((committed / total) * 100) / 100 : 0,
        by_category: [...byCat.entries()].map(([category, amount]) => ({ category, amount: r(amount), per_month: r(amount / months) })).sort((a, b) => b.amount - a.amount),
        top_payees: [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([payee, amount]) => ({ payee, amount: r(amount) })),
      };
    },
  },
  {
    name: "income_and_payday",
    description:
      "Detect the user's regular income (salary etc.) from money-in transactions, the next expected payday, how much of income is already committed to bills, and which bills fall due before payday. Use for 'help me organise my bills before payday' or 'how much is left after bills'.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: async (_i, { state, rates, today }) => {
      const home = state.settings.homeCurrency;
      const inc = income(state.transactions, home, today);
      const c = commitments(state.subscriptions, home, rates);
      const before = inc.nextPayday ? dueBefore(state.subscriptions, today, inc.nextPayday) : [];
      return {
        currency: home,
        income_sources: inc.sources,
        regular_monthly_income: Math.round(inc.monthlyRecurring),
        average_monthly_money_in: Math.round(inc.averageMonthlyIn),
        next_payday: inc.nextPayday ?? null,
        committed_monthly: c.monthlyHome === null ? null : Math.round(c.monthlyHome),
        committed_share_of_income: inc.monthlyRecurring && c.monthlyHome !== null ? Math.round((c.monthlyHome / inc.monthlyRecurring) * 100) / 100 : null,
        due_before_payday: before.map((s) => ({ ...brief(s), amount_home: toHome(s.amount, s.currency, home, rates) })),
        due_before_payday_total: Math.round(before.reduce((x, s) => x + (toHome(s.amount, s.currency, home, rates) ?? 0), 0)),
        note: inc.sources.length ? undefined : "No regular income detected — the statement may not include salary credits.",
      };
    },
  },
  {
    name: "savings_analysis",
    description:
      "Estimate how much the user could save per month by acting on cuttable subscriptions: overlapping services, price rises, annual plans. Rent, loans and utilities are not counted as cuttable. These are suggestions — the user decides.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: async (_i, { state, rates, today }) => {
      const home = state.settings.homeCurrency;
      const sp = savingsPotential(state.subscriptions, home, rates, today);
      return { currency: home, potential_monthly_saving: Math.round(sp.monthly), potential_yearly_saving: Math.round(sp.monthly * 12), suggestions: sp.flags };
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
  {
    name: "autopilot_check",
    description:
      "Explain Autopilot (automatic bill payments from the user's Altana wallet): whether it is on, when access expires, the monthly limits, approved recipients, and for each bill marked to pay automatically whether it would be paid when due and, if not, why. Read-only: it never pays. Balance and remaining monthly allowance are re-checked on-chain by the server at payment time.",
    input_schema: { type: "object", properties: { ref: { type: "string", description: "Optional bill id or name to check" } }, required: [], additionalProperties: false },
    run: async (input, { state, today }) => {
      const ap = state.autopilot;
      if (!ap?.wallet) return { set_up: false, note: "Autopilot isn't set up. The user can turn it on in Settings → Autopilot." };
      const now = Date.now() / 1000;
      const active = !!ap.sealedPolicy && !ap.revokedAt && (ap.expiry ?? 0) > now;
      const bills = state.subscriptions.filter((s) => (input.ref ? s === findSub(state, input.ref) : s.autopay) && s.status !== "dismissed");
      return {
        set_up: true,
        on: active && ap.enabled,
        access: ap.revokedAt ? "revoked" : !ap.sealedPolicy ? "not granted" : (ap.expiry ?? 0) <= now ? "expired" : "active",
        expires: ap.expiry ? new Date(ap.expiry * 1000).toISOString().slice(0, 10) : null,
        monthly_limits: { USDT: ap.limits.USDT, cNGN: ap.limits.cNGN },
        approved_recipients: ap.recipients.map((r) => r.label),
        bills: bills.map((s) => {
          const reasons: string[] = [];
          if (!s.autopay) reasons.push("not switched to pay automatically");
          if (!s.payment?.address) reasons.push("no verified wallet address for this provider");
          else if (!ap.recipients.some((r) => r.address.toLowerCase() === s.payment!.address!.toLowerCase())) reasons.push("recipient not approved");
          if (!active) reasons.push(`access ${ap.revokedAt ? "revoked" : "not active"}`);
          else if (!ap.enabled) reasons.push("Autopilot is paused");
          return { name: s.displayName, amount: s.amount, currency: s.currency, next_due: s.nextRenewal, will_pay_when_due: reasons.length === 0, why_not: reasons, note: reasons.length ? undefined : "Balance and remaining monthly allowance are checked on-chain at payment time." };
        }),
        today,
      };
    },
  },
];

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}
