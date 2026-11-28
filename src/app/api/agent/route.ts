// subscan's agent API: runs one deterministic tool over the user's own data and
// returns its result. There is no language model. Read-only tools only; payments
// go through /api/autopilot, which enforces the user's Altana permissions.
import { NextResponse } from "next/server";
import { toolByName } from "@/lib/agent/tools";
import { indicativeUsdNgn } from "@/lib/textile/rate";
import type { RateTable } from "@/lib/detection/analysis";
import type { AppState } from "@/lib/types";

const READ_ONLY = new Set(["spending_analysis", "spending_breakdown", "upcoming_renewals", "find_waste", "savings_analysis", "income_and_payday", "autopilot_check", "check_wallet_balance", "transaction_status", "list_subscriptions", "get_subscription", "search_transactions"]);

export async function GET() {
  return NextResponse.json({ data: { engine: "rules", tools: [...READ_ONLY] } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { tool?: string; input?: Record<string, unknown>; state?: AppState } | null;
  if (!body?.tool || !body.state) return NextResponse.json({ error: "tool and state required" }, { status: 400 });
  if (!READ_ONLY.has(body.tool)) return NextResponse.json({ error: "unknown or non read-only tool" }, { status: 400 });
  const tool = toolByName(body.tool)!;
  const rates: RateTable = {};
  if (body.state.settings?.homeCurrency === "NGN") {
    try {
      rates.USD = (await indicativeUsdNgn()).ngnPerUsd; // live Textile FX rate, only to total mixed currencies
    } catch {
      /* totals stay per currency */
    }
  }
  try {
    const result = await tool.run(body.input ?? {}, { state: body.state, rates, today: new Date().toISOString().slice(0, 10) });
    return NextResponse.json({ data: { tool: body.tool, result } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Tool failed" }, { status: 500 });
  }
}
