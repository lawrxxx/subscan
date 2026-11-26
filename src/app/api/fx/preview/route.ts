import { NextResponse } from "next/server";
import { preview } from "@/lib/textile/client";
import { isToken, textileErrorResponse } from "@/lib/textile/http";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isToken(b.sellToken) || !isToken(b.buyToken)) return NextResponse.json({ error: "Unsupported token pair" }, { status: 400 });
  try {
    return NextResponse.json({ data: await preview({ sellToken: b.sellToken, buyToken: b.buyToken, sellAmount: b.sellAmount, buyAmount: b.buyAmount }) });
  } catch (e) {
    return textileErrorResponse(e);
  }
}
