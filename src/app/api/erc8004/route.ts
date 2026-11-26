import { NextResponse } from "next/server";
import { ERC8004, CHAIN_ID } from "@/lib/celo/config";

// ERC-8004 registration file (registration-v1) for the subscan agent.
// Register it on the Identity Registry with `npm run agent:register` or from
// Settings → Agent identity, then set ERC8004_AGENT_ID so `registrations` is filled.
export async function GET(req: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const agentId = process.env.ERC8004_AGENT_ID;
  return NextResponse.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "subscan agent",
    description:
      "Subscription intelligence and payment preparation agent. Detects recurring payments from imported statements, analyses spend, and prepares user-approved cross-currency payments on Celo via Textile FX (USD₮ ↔ cNGN).",
    image: `${origin}/icon.svg`,
    services: [{ name: "web", endpoint: origin }],
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
    registrations: agentId ? [{ agentId: Number(agentId), agentRegistry: `eip155:${CHAIN_ID}:${ERC8004.identityRegistry}` }] : [],
  });
}
