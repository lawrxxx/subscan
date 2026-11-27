import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, toolByName, type ToolContext } from "./tools.ts";

export interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  error?: boolean;
}

export interface AgentReply {
  text: string;
  trace: ToolTrace[];
  mode: "claude" | "local";
  model?: string;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MODEL = process.env.SUBSCAN_AGENT_MODEL || "claude-opus-5-5";

const SYSTEM = `You are subscan, a personal bills and subscriptions agent. You help ordinary people understand what their money is committed to and manage upcoming payments. Most users know nothing about crypto — speak plainly about bills, money in and money out.

Ground rules:
- Answer only from tool results. Fetch the user's real bills, transactions, income, spending and payments with tools; never guess numbers.
- Bills come from bank/card statements the user imported (or added by hand). Due dates are estimates from billing history; say so when it matters. Variable bills (electricity, water) use a typical amount.
- "How much do I owe this month": use upcoming_renewals / income_and_payday and include any expected payments missing from the statement.
- Savings and "can I cancel" answers are suggestions — the user decides. You cannot cancel anything; say what the user would need to do (e.g. cancel in the provider's app).
- You cannot move money. prepare_payment builds a draft with a live quote; the user reviews and approves every transaction on the review screen. Give the review link from the tool result as a markdown link. Payments settle in digital dollars (USD₮) or naira (cNGN) on Celo, only to a recipient the user has verified. Most utility providers and many merchants don't accept these yet — if a bill has no verified payment method, say so and explain the user can add the provider's Celo address or x402 link on the bill's page if the provider supports it. Never invent addresses or claim a bill was paid.
- To confirm, dismiss, restore or re-categorise bills use propose_subscription_changes. It only proposes: tell the user to press the button below your answer.
- Write concisely: short paragraphs or tight lists, amounts with currency, no filler. Use markdown sparingly.`;

export async function runClaude(history: ChatTurn[], ctx: ToolContext): Promise<AgentReply> {
  const client = new Anthropic();
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true }));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((h) => ({ role: h.role, content: h.content }));
  const trace: ToolTrace[] = [];

  for (let i = 0; i < 8; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return { text: "I can't help with that request.", trace, mode: "claude", model: response.model };
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text: text || "(no answer)", trace, mode: "claude", model: response.model };
    }

    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = toolByName(u.name);
        const input = (u.input ?? {}) as Record<string, unknown>;
        try {
          if (!tool) throw new Error(`Unknown tool ${u.name}`);
          const result = await tool.run(input, ctx);
          trace.push({ name: u.name, input, result });
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          trace.push({ name: u.name, input, result: { error: msg }, error: true });
          return { type: "tool_result", tool_use_id: u.id, content: msg, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { text: "I stopped after several tool steps without a final answer. Try a narrower question.", trace, mode: "claude" };
}

// ---------------------------------------------------------------------------
// Local mode: used only when no ANTHROPIC_API_KEY is configured. It routes the
// request to the same tools with simple intent matching and summarises the
// real tool output. It is labelled "local intent mode" in the UI.

function fmt(n: number, ccy: string) {
  return `${ccy} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export async function runLocal(message: string, ctx: ToolContext): Promise<AgentReply> {
  const m = message.toLowerCase();
  const trace: ToolTrace[] = [];
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const result = (await toolByName(name)!.run(input, ctx)) as Record<string, unknown>;
    trace.push({ name, input, result });
    return result as Record<string, any>;
  };

  const action = /\b(dismiss|remove|hide)\b/.test(m) ? "dismiss" : /\b(confirm|approve|mark)\b/.test(m) && !/pay/.test(m) ? "confirm" : /\b(restore|undo)\b/.test(m) ? "restore" : null;
  if (action) {
    const named = ctx.state.subscriptions.filter((s) => m.includes(s.displayName.toLowerCase()) || m.includes(s.merchant));
    const refs = named.length ? named.map((s) => s.id) : /(all|everything|high|confident)/.test(m) ? ["high_confidence"] : [];
    if (!refs.length) return { text: `Which bill should I ${action}? Name it, or say "${action} all high-confidence ones".`, trace, mode: "local" };
    const r = await call("propose_subscription_changes", { action, refs });
    if (!r.changes.length) return { text: "Nothing to change — those are already in that state.", trace, mode: "local" };
    return { text: `Ready to ${action} ${r.changes.length} bill${r.changes.length > 1 ? "s" : ""}. Check the list below and press **${action[0].toUpperCase() + action.slice(1)}** to apply it — nothing changes until you do.`, trace, mode: "local" };
  }
  const listing = /\b(show|list|what are|all my)\b.*\b(bills|subscriptions|utilities|obligations|payments i make)\b/.test(m) && !/due|coming|next|owe/.test(m);
  if (/payday|salary|before .*paid|left after/.test(m)) {
    const r = await call("income_and_payday");
    if (!r.next_payday) return { text: r.note ?? "I couldn’t find regular income in your statement.", trace, mode: "local" };
    const lines = [
      `Next payday looks like **${r.next_payday}** (regular income about ${fmt(r.regular_monthly_income, r.currency)}/month).`,
      r.committed_monthly !== null ? `About ${fmt(r.committed_monthly, r.currency)} a month — ${Math.round((r.committed_share_of_income ?? 0) * 100)}% of that income — is already committed to bills.` : "",
      r.due_before_payday.length ? `Due before then (${fmt(r.due_before_payday_total, r.currency)}):` : "Nothing else is due before payday.",
      ...r.due_before_payday.map((b: any) => `- ${b.expected_payment_missing ? "⚠ " : ""}**${b.name}** — ${fmt(b.amount, b.currency)}${b.expected_payment_missing ? ` (expected ${b.expected_payment_missing}, not in statement)` : `, due ${b.next_renewal}`}`),
    ].filter(Boolean);
    return { text: lines.join("\n"), trace, mode: "local" };
  }
  if (/where.*(money|spend)|going|breakdown|analy[sz]e (my )?statement/.test(m)) {
    const r = await call("spending_breakdown");
    if (!r.period) return { text: "No transactions imported yet.", trace, mode: "local" };
    return {
      text: [
        `From ${r.period.from} to ${r.period.to} you spent ${fmt(r.total_out, r.currency)} — about ${fmt(r.monthly_average_out, r.currency)} a month. ${Math.round(r.recurring_bills_share * 100)}% went to recurring bills.`,
        ...r.by_category.slice(0, 7).map((c: any) => `- ${c.category}: ${fmt(c.per_month, r.currency)}/month`),
      ].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/(could|can) i save|how much.*save|savings/.test(m)) {
    const r = await call("savings_analysis");
    if (!r.suggestions.length) return { text: "Nothing obvious to cut — no overlapping services or big price rises.", trace, mode: "local" };
    return {
      text: [`You could save about **${fmt(r.potential_monthly_saving, r.currency)} a month** (${fmt(r.potential_yearly_saving, r.currency)} a year) if you act on these:`, ...r.suggestions.slice(0, 6).map((f: any) => `- **${f.name}**: ${f.reason}`), "", "These are suggestions — cancel in each provider’s app if you agree."].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/\b(when did i|find|search|transactions? (to|from|for))\b/.test(m)) {
    const q = m.replace(/.*\b(when did i pay|find|search( for)?|transactions? (to|from|for))\b/, "").replace(/[?.!]/g, "").trim().split(" ").slice(0, 3).join(" ");
    const r = await call("search_transactions", { query: q });
    if (!r.matches) return { text: `No transactions matching “${q}”.`, trace, mode: "local" };
    return { text: [`${r.matches} transactions matching “${q}” (out ${fmt(r.total_out, ctx.state.settings.homeCurrency)}):`, ...r.transactions.slice(0, 8).map((t: any) => `- ${t.date} · ${t.description} · ${t.direction === "credit" ? "+" : ""}${fmt(t.amount, t.currency)}`)].join("\n"), trace, mode: "local" };
  }
  if (/\bprepare\b|\bpay (my|for|the|off)\b|\bsettle\b/.test(m)) {
    const intl = /international|foreign|usd|dollar/.test(m);
    const named = ctx.state.subscriptions.find((s) => m.includes(s.displayName.toLowerCase()) || (s.status !== "dismissed" && m.includes(s.category.toLowerCase())));
    const r = await call("prepare_payment", { ...(named ? { ref: named.id } : {}), international_only: intl && !named });
    if (r.error) return { text: r.error, trace, mode: "local" };
    const lines = [`Prepared a draft for **${r.subscription.name}** — ${fmt(r.subscription.amount, r.subscription.currency)}, renews ${r.subscription.next_renewal}.`];
    if (r.plan.problems.length) lines.push(...r.plan.problems.map((p: string) => `- ${p}`));
    if (r.quote?.pay) lines.push(`Indicative Textile FX quote: pay ${r.quote.pay}, receive ${r.quote.receive} (${r.quote.rate}).`);
    else if (r.quote?.error || r.quote?.reason) lines.push(`Quote unavailable: ${r.quote.error ?? r.quote.reason}.`);
    if (r.balance?.available) lines.push(`Wallet ${r.balance.token} balance: ${r.balance.available}${r.balance.sufficient === false ? " — not enough" : ""}.`);
    lines.push(`Nothing has been sent. [Review and approve](${r.review_url}).`);
    return { text: lines.join("\n"), trace, mode: "local" };
  }
  if (/(wast|cancel|sav(e|ing)|unused|duplicate|overlap)/.test(m)) {
    const r = await call("find_waste");
    if (/duplicate|overlap|twice/.test(m)) {
      const d = r.flags.filter((f: any) => /overlapping|billed \d+ times|running at once/.test(f.reason));
      if (!d.length) return { text: "No duplicate or overlapping payments found.", trace, mode: "local" };
      return { text: ["Possible duplicates and overlaps:", ...d.map((f: any) => `- **${f.name}** (${fmt(f.monthly, f.currency)}/mo): ${f.reason}`), "", "Keep the one you use; cancel the rest in each provider’s app."].join("\n"), trace, mode: "local" };
    }
    if (!r.flags.length) return { text: "Nothing stands out — no overlaps, price jumps or lapsed plans.", trace, mode: "local" };
    return {
      text: ["Worth a look:", ...r.flags.slice(0, 6).map((f: any) => `- **${f.name}** (${fmt(f.monthly, f.currency)}/mo): ${f.reason}`)].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/\bowe\b|this month/.test(m)) {
    const end = new Date(Date.parse(ctx.today));
    const monthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const days = Math.max(1, Math.round((Date.parse(monthEnd) - Date.parse(ctx.today)) / 86_400_000));
    const r = await call("upcoming_renewals", { within_days: days });
    const missed = ctx.state.subscriptions.filter((s) => s.status !== "dismissed" && !s.lapsed && s.missed);
    const byCcy = new Map<string, number>();
    for (const b of [...r.renewals, ...missed.map((s) => ({ amount: s.amount, currency: s.currency }))]) byCcy.set(b.currency, (byCcy.get(b.currency) ?? 0) + b.amount);
    if (!r.renewals.length && !missed.length) return { text: `Nothing else is due before the end of the month (${monthEnd}).`, trace, mode: "local" };
    return {
      text: [
        `Still to pay before ${monthEnd}: **${[...byCcy].map(([c, v]) => fmt(v, c)).join(" + ")}**`,
        ...missed.map((s) => `- ⚠ **${s.displayName}** — ${fmt(s.amount, s.currency)} (expected ${s.missed!.expected}, not in your statement)`),
        ...r.renewals.map((b: any) => `- **${b.name}** — ${b.bill_type === "variable" ? "≈" : ""}${fmt(b.amount, b.currency)}, due ${b.next_renewal}`),
      ].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/(next|renew|upcoming|due|coming up)/.test(m)) {
    const r = await call("upcoming_renewals", { within_days: 60 });
    if (!r.renewals.length) return { text: "No renewals expected in the next 60 days.", trace, mode: "local" };
    const n = r.renewals[0];
    return {
      text: [`Next up: **${n.name}** on ${n.next_renewal} (${n.days_until === 0 ? "today" : n.days_until === 1 ? "tomorrow" : `in ${n.days_until} days`}) — ${fmt(n.amount, n.currency)}.`, ...r.renewals.slice(1, 5).map((s: any) => `- ${s.name}: ${s.next_renewal}, ${fmt(s.amount, s.currency)}`)].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (!listing && /(spend|cost|total|month|year|annual)/.test(m)) {
    const r = await call("spending_analysis");
    const lines = r.byCurrency.map((c: any) => `- ${fmt(c.monthly, c.currency)} per month across ${c.count} bills`);
    if (r.monthlyHome !== null) lines.unshift(`About **${fmt(r.monthlyHome, r.home)} per month**, ${fmt(r.annualHome, r.home)} a year (foreign amounts converted at the live Textile FX rate).`);
    return { text: lines.join("\n"), trace, mode: "local" };
  }
  if (/(balance|wallet)/.test(m)) {
    const r = await call("check_wallet_balance");
    if (r.error) return { text: r.error, trace, mode: "local" };
    return { text: `${r.address.slice(0, 6)}…${r.address.slice(-4)} on Celo: ${r.USDT} USD₮, ${r.cNGN} cNGN, ${r.CELO} CELO.`, trace, mode: "local" };
  }
  if (/(status|transaction|receipt|hash)/.test(m)) {
    const r = await call("transaction_status");
    if (!r.payments.length) return { text: "No payments recorded yet.", trace, mode: "local" };
    return { text: r.payments.map((p: any) => `- ${p.merchant}: ${p.status}`).join("\n"), trace, mode: "local" };
  }
  const type = /utilit|electric|internet|water/.test(m) ? "utility" : /rent|loan|insurance|obligation/.test(m) ? "obligation" : /subscription/.test(m) && !/bill/.test(m) ? "subscription" : "all";
  const r = await call("list_subscriptions", { status: "active", type, international_only: /international|foreign/.test(m) });
  if (!r.count) return { text: "No bills yet — upload a statement first.", trace, mode: "local" };
  const label: Record<string, string> = { subscription: "Subscriptions", utility: "Utilities", obligation: "Other obligations" };
  const groups = ["subscription", "utility", "obligation"].map((k) => ({ k, list: r.subscriptions.filter((s: any) => s.type === k) })).filter((g) => g.list.length);
  return {
    text: [
      `${r.count} recurring bills:`,
      ...groups.flatMap((g) => [`**${label[g.k]}**`, ...g.list.map((s: any) => `- ${s.name} — ${s.bill_type === "variable" ? "≈" : ""}${fmt(s.amount, s.currency)} ${s.frequency}, next ${s.next_renewal}`)]),
    ].join("\n"),
    trace,
    mode: "local",
  };
}
