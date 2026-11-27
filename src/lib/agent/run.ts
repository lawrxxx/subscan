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

const SYSTEM = `You are the subscan agent: a careful subscription and payments assistant inside a consumer fintech app on Celo mainnet.

Ground rules:
- Answer only from tool results. Call tools to fetch the user's real subscriptions, spend, renewals, balances and payment status; never guess numbers.
- Subscription data comes from transactions the user imported. Renewal dates are estimates from billing history; say so when it matters.
- You cannot move money. prepare_payment builds a draft with a live indicative Textile FX quote; the user reviews and approves every on-chain transaction on the review screen. Say this plainly when you prepare a payment and give the review link from the tool result as a markdown link.
- If a subscription has no verified merchant payment method, explain that the user must add the merchant's Celo receiving address or x402 endpoint on the subscription page. Never invent addresses.
- Waste flags are suggestions for the user to judge, not conclusions.
- To confirm, dismiss or restore subscriptions use propose_subscription_changes. It only proposes: tell the user to press Apply below your answer.
- Write concisely: short paragraphs or tight lists, amounts with currency codes, no filler. Use markdown sparingly.`;

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
    if (!refs.length) return { text: `Which subscription should I ${action}? Name it, or say "${action} all high-confidence ones".`, trace, mode: "local" };
    const r = await call("propose_subscription_changes", { action, refs });
    if (!r.changes.length) return { text: "Nothing to change — those are already in that state.", trace, mode: "local" };
    return { text: `Ready to ${action} ${r.changes.length} subscription${r.changes.length > 1 ? "s" : ""}. Check the list below and press **${action[0].toUpperCase() + action.slice(1)}** to apply it — nothing changes until you do.`, trace, mode: "local" };
  }
  if (/(prepare|pay|settle)/.test(m)) {
    const intl = /international|foreign|usd|dollar/.test(m);
    const named = ctx.state.subscriptions.find((s) => m.includes(s.displayName.toLowerCase()));
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
    if (!r.flags.length) return { text: "Nothing stands out — no overlaps, price jumps or lapsed plans.", trace, mode: "local" };
    return {
      text: ["Worth a look:", ...r.flags.slice(0, 6).map((f: any) => `- **${f.name}** (${fmt(f.monthly, f.currency)}/mo): ${f.reason}`)].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/(next|renew|upcoming|due)/.test(m)) {
    const r = await call("upcoming_renewals", { within_days: 60 });
    if (!r.renewals.length) return { text: "No renewals expected in the next 60 days.", trace, mode: "local" };
    const n = r.renewals[0];
    return {
      text: [`Next up: **${n.name}** on ${n.next_renewal} (${n.days_until} days) — ${fmt(n.amount, n.currency)}.`, ...r.renewals.slice(1, 5).map((s: any) => `- ${s.name}: ${s.next_renewal}, ${fmt(s.amount, s.currency)}`)].join("\n"),
      trace,
      mode: "local",
    };
  }
  if (/(spend|cost|total|month|year|annual)/.test(m)) {
    const r = await call("spending_analysis");
    const lines = r.byCurrency.map((c: any) => `- ${fmt(c.monthly, c.currency)} per month across ${c.count} subscriptions`);
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
  const r = await call("list_subscriptions", { status: "active", international_only: /international|foreign/.test(m) });
  if (!r.count) return { text: "No subscriptions yet — import a statement first.", trace, mode: "local" };
  return {
    text: [`${r.count} subscriptions:`, ...r.subscriptions.map((s: any) => `- **${s.name}** — ${fmt(s.amount, s.currency)} ${s.frequency}, next ${s.next_renewal}`)].join("\n"),
    trace,
    mode: "local",
  };
}
