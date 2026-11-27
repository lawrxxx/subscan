import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { runClaude, runLocal, type ChatTurn } from "@/lib/agent/run";
import { indicativeUsdNgn } from "@/lib/textile/rate";
import type { RateTable } from "@/lib/detection/analysis";
import type { AppState } from "@/lib/types";
import { loadState } from "@/lib/db/repo";
import { serverSupabase } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: ChatTurn[]; state?: AppState } | null;
  if (!body?.messages?.length) return NextResponse.json({ error: "messages required" }, { status: 400 });
  // Signed-in users: the agent reads their data from the database, never from the client.
  const supabase = await serverSupabase();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (supabase && !user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  let state: AppState | undefined = body.state;
  if (supabase && user) {
    try {
      state = await loadState(supabase, user.id);
    } catch (e) {
      return NextResponse.json({ error: `Could not load your data: ${(e as Error).message}` }, { status: 500 });
    }
  }
  if (!state) return NextResponse.json({ error: "state required" }, { status: 400 });
  const history = body.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-20);
  if (history[history.length - 1]?.role !== "user") return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });

  const rates: RateTable = {};
  if (state.settings.homeCurrency === "NGN") {
    try {
      rates.USD = (await indicativeUsdNgn()).ngnPerUsd;
    } catch {
      /* rate unavailable: totals stay per-currency */
    }
  }
  const ctx = { state, rates, today: new Date().toISOString().slice(0, 10) };

  try {
    const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    const reply = hasKey ? await runClaude(history, ctx) : await runLocal(history[history.length - 1].content, ctx);
    if (supabase && user) {
      await supabase.from("agent_events").insert({
        user_id: user.id,
        question: history[history.length - 1].content.slice(0, 2000),
        reply: reply.text,
        mode: reply.mode,
        tools: reply.trace.map((t) => ({ name: t.name, input: t.input })),
      });
    }
    return NextResponse.json({ data: reply });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "The agent is rate limited. Try again in a moment." }, { status: 429 });
    if (e instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "Anthropic API key rejected. Check ANTHROPIC_API_KEY." }, { status: 401 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Agent model error (${e.status}): ${e.message}` }, { status: 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Agent failed" }, { status: 500 });
  }
}
