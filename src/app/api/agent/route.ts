import { NextResponse } from "next/server";
import { AgentUnavailable, describeError, GEMINI_MODEL, runGemini, type ChatTurn } from "@/lib/agent/run";
import { indicativeUsdNgn } from "@/lib/textile/rate";
import type { RateTable } from "@/lib/detection/analysis";
import type { AppState } from "@/lib/types";

export const maxDuration = 120;

/** Lets the UI show an "agent unavailable" state before the user types anything. */
export async function GET() {
  return NextResponse.json({ data: { available: !!process.env.GEMINI_API_KEY, model: GEMINI_MODEL } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: ChatTurn[]; state?: AppState } | null;
  if (!body?.messages?.length || !body.state) return NextResponse.json({ error: "messages and state required" }, { status: 400 });
  const history = body.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (history[history.length - 1]?.role !== "user") return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });
  if (!process.env.GEMINI_API_KEY) {
    const { error, code } = describeError(new AgentUnavailable());
    return NextResponse.json({ error, code }, { status: 503 });
  }

  // The state stays on this server: tools compute over it and only their (redacted) results go to the model.
  const rates: RateTable = {};
  if (body.state.settings.homeCurrency === "NGN") {
    try {
      rates.USD = (await indicativeUsdNgn()).ngnPerUsd;
    } catch {
      /* rate unavailable: totals stay per-currency */
    }
  }
  const ctx = { state: body.state, rates, today: new Date().toISOString().slice(0, 10) };

  try {
    return NextResponse.json({ data: await runGemini(history, ctx) });
  } catch (e) {
    const { status, error, code } = describeError(e);
    console.error("agent error", code, e instanceof Error ? e.message : e);
    return NextResponse.json({ error, code }, { status });
  }
}
