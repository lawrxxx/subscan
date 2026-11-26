import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { CHAIN, RPC_URL } from "@/lib/celo/config";
import { indicativeUsdNgn } from "@/lib/textile/rate";

export const dynamic = "force-dynamic";

export async function GET() {
  const chain = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
  const [block, fx] = await Promise.allSettled([chain.getBlockNumber(), indicativeUsdNgn()]);
  return NextResponse.json({
    data: {
      celoRpc: block.status === "fulfilled" ? { ok: true, block: block.value.toString() } : { ok: false, error: String(block.reason) },
      textile: fx.status === "fulfilled" ? { ok: true, ngnPerUsd: fx.value.ngnPerUsd, auth: process.env.TEXTILE_API_KEY ? "api-key" : "wallet-proof" } : { ok: false, error: String(fx.reason) },
      agent: { llm: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), model: process.env.SUBSCAN_AGENT_MODEL || "claude-opus-5-5" },
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      mono: !!process.env.NEXT_PUBLIC_MONO_PUBLIC_KEY,
      erc8004AgentId: process.env.ERC8004_AGENT_ID ?? null,
    },
  });
}
