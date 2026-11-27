// Gemini-powered agent loop. The model decides which application tools to call;
// every figure it reports comes from those deterministic tools (detection,
// analysis, Textile FX quotes, Celo reads). It cannot move money: prepare_payment
// only builds a draft that the user approves and signs on the payment screen.
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { redact } from "./privacy.ts";
import { TOOLS, toolByName, type ToolContext } from "./tools.ts";

export interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  error?: boolean;
}

export interface Evidence {
  bills: { id: string; name: string }[];
  transactions: { date: string; description: string; amount: number; currency: string; direction: string }[];
}

export interface AgentReply {
  text: string;
  trace: ToolTrace[];
  evidence: Evidence;
  mode: "gemini";
  model: string;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export class AgentUnavailable extends Error {}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_STEPS = 8;
const TIMEOUT_MS = 45_000;

const SYSTEM = `You are "Ask subscan", a friendly money assistant. You help ordinary people see what they spend, which payments are coming up and where they could save, using their own bank statements. Many users have never used a finance app and know nothing about crypto.

Accuracy rules (strict):
- Every number, merchant, bill, date and status you mention must come from a tool result in this conversation. Call tools to get them. Never estimate, add up, convert currency or work out percentages yourself: use the totals, rates and amounts the tools return. If you need a figure no tool gives, say you can't calculate it.
- If the data isn't there (no statement imported, no matching bill, no payments), say so plainly. Never invent transactions, bills, merchants or payment statuses.
- Due dates are estimates from billing history; usage-based bills (electricity, water) use a typical amount. Mention this when it matters.
- If a request is ambiguous (e.g. which of two similar bills, which period), ask one short clarifying question instead of guessing.

Actions:
- Savings and "should I cancel" answers are recommendations. You cannot cancel anything; say what the user would do (cancel in the provider's app).
- You cannot move money. prepare_payment builds a draft with a live quote; the user reviews and approves it on the payment screen and signs in their own wallet. Always give the tool's review_url as a markdown link. Say clearly that nothing has been sent. If the bill has no verified payment method, explain the user can add the provider's Celo address or x402 link on the bill's page if the provider accepts it. Never claim a payment was made unless transaction_status shows it confirmed.
- To confirm, dismiss, restore or re-categorise bills, call propose_subscription_changes. It only proposes: tell the user to press the button under your answer.
- Keep "recommended" and "done" separate: nothing changes until the user approves it.

Language: plain, everyday words. Say "regular payments" (not recurring, obligations or commitments), "how sure we are" (not confidence score), "spending" and "payments". No financial or technical jargon; never mention tools, functions, Celo, tokens or blockchain unless the user asks about paying from their wallet.

Style: short answers first, then the detail. Short paragraphs or tight bullet lists, amounts with their currency, the payments or transactions behind each conclusion named, no filler. Markdown only for **bold**, bullets and links.`;

function declarations(): FunctionDeclaration[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
}

/** Bills and transactions referenced by tool results, so the UI can show what an answer is based on. */
function collectEvidence(trace: ToolTrace[], ctx: ToolContext): Evidence {
  const ids = new Set(ctx.state.subscriptions.map((s) => s.id));
  const bills = new Map<string, string>();
  const txs: Evidence["transactions"] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && ids.has(o.id) && typeof o.name === "string") bills.set(o.id, o.name);
    Object.values(o).forEach(walk);
  };
  for (const t of trace) {
    if (t.error) continue;
    walk(t.result);
    if (t.name === "search_transactions") txs.push(...((t.result as { transactions?: Evidence["transactions"] }).transactions ?? []));
  }
  return { bills: [...bills].slice(0, 12).map(([id, name]) => ({ id, name })), transactions: txs.slice(0, 10) };
}

export async function runGemini(history: ChatTurn[], ctx: ToolContext, client?: GoogleGenAI): Promise<AgentReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!client && !apiKey) throw new AgentUnavailable("GEMINI_API_KEY is not set");
  const ai = client ?? new GoogleGenAI({ apiKey });
  const contents: Content[] = history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }));
  const trace: ToolTrace[] = [];
  const deadline = Date.now() + TIMEOUT_MS * 2;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() > deadline) break;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations: declarations() }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      const blocked = response.promptFeedback?.blockReason ?? candidate?.finishReason;
      return { text: blocked ? `I can't answer that (${blocked}).` : "The model returned no answer. Try rephrasing.", trace, evidence: collectEvidence(trace, ctx), mode: "gemini", model: GEMINI_MODEL };
    }
    // Keep the model's turn verbatim (it carries thought signatures needed for multi-step calls).
    contents.push(candidate.content);

    const calls = response.functionCalls ?? [];
    if (!calls.length) {
      const text = (candidate.content.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      return { text: text || "(no answer)", trace, evidence: collectEvidence(trace, ctx), mode: "gemini", model: response.modelVersion ?? GEMINI_MODEL };
    }

    const parts: Part[] = await Promise.all(
      calls.map(async (call): Promise<Part> => {
        const name = call.name ?? "";
        const input = (call.args ?? {}) as Record<string, unknown>;
        const tool = toolByName(name);
        try {
          if (!tool) throw new Error(`Unknown tool ${name}`);
          const result = redact(await tool.run(input, ctx));
          trace.push({ name, input, result });
          return { functionResponse: { id: call.id, name, response: { output: result } } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          trace.push({ name, input, result: { error: msg }, error: true });
          return { functionResponse: { id: call.id, name, response: { error: msg } } };
        }
      }),
    );
    contents.push({ role: "user", parts });
  }
  return { text: "I couldn't finish that within a few steps. Try a narrower question.", trace, evidence: collectEvidence(trace, ctx), mode: "gemini", model: GEMINI_MODEL };
}

/** Maps SDK/network failures to a user-facing message and HTTP status. Never fabricates an answer. */
export function describeError(e: unknown): { status: number; error: string; code: string } {
  if (e instanceof AgentUnavailable) return { status: 503, code: "unavailable", error: "The agent isn't configured on this deployment (GEMINI_API_KEY is missing)." };
  if (e instanceof ApiError) {
    if (e.status === 429) return { status: 429, code: "rate_limited", error: "The agent is getting too many requests right now. Try again in a minute." };
    if (e.status === 401 || e.status === 403) return { status: 503, code: "unavailable", error: "The agent's API key was rejected. Check GEMINI_API_KEY." };
    if (e.status === 400) return { status: 502, code: "model_error", error: `The model rejected the request: ${e.message.slice(0, 200)}` };
    return { status: 502, code: "model_error", error: `The model service failed (${e.status}). Try again shortly.` };
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { status: 504, code: "timeout", error: "The agent took too long to answer. Try again, or ask something narrower." };
  return { status: 500, code: "failed", error: e instanceof Error ? e.message : "The agent failed." };
}
