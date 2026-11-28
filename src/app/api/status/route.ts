import { NextResponse } from "next/server";
import { ASSIGNED_MATCHES_REPO, ATTRIBUTION_CODES, REPO_CODE } from "@/lib/celo/attribution";
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
      agent: { engine: "rules", wallet: "altana", autopilot: !!process.env.AUTOPILOT_SEAL_KEY },
      storage: "browser",
      attribution: { app: "subscan", codes: ATTRIBUTION_CODES, assigned: true, repoCode: REPO_CODE, assignedMatchesRepo: ASSIGNED_MATCHES_REPO },
      erc8004AgentId: process.env.ERC8004_AGENT_ID ?? null,
    },
  });
}
