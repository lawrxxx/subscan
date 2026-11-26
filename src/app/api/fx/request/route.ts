import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { requestFirm } from "@/lib/textile/client";
import { isToken, textileErrorResponse } from "@/lib/textile/http";

// Firm quote: locks maker inventory for ~60s, bound to the taker wallet.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isToken(b.sellToken) || !isToken(b.buyToken)) return NextResponse.json({ error: "Unsupported token pair" }, { status: 400 });
  if (!isAddress(b.taker ?? "")) return NextResponse.json({ error: "taker must be a wallet address" }, { status: 400 });
  try {
    const data = await requestFirm({ sellToken: b.sellToken, buyToken: b.buyToken, sellAmount: b.sellAmount, buyAmount: b.buyAmount }, b.taker, b.takerProof);
    return NextResponse.json({ data });
  } catch (e) {
    return textileErrorResponse(e);
  }
}
