import { NextResponse } from "next/server";
import { ERC8004, CHAIN_ID } from "@/lib/celo/config";

// ERC-8004 registration file (registration-v1) for the subscan agent.
// Register it on the Identity Registry with `npm run agent:register` or from
// Settings → Everyday wallet → Agent identity, then set ERC8004_AGENT_ID so `registrations` is filled.
export async function GET(req: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const agentId = process.env.ERC8004_AGENT_ID;
  return NextResponse.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "subscan money autopilot",
    description:
      "Rule-based personal money agent on Celo. Keeps a person's stablecoin balances where they want them (converting USD₮ ↔ cNGN through Textile FX at firm quotes) and sends their recurring transfers to saved recipients, from their own Altana smart wallet, within the limits, recipients and expiry they granted. No language model.",
    image: `${origin}/icon.svg`,
    services: [{ name: "web", endpoint: origin }],
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
    registrations: agentId ? [{ agentId: Number(agentId), agentRegistry: `eip155:${CHAIN_ID}:${ERC8004.identityRegistry}` }] : [],
  });
}
