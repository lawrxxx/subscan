import { NextResponse } from "next/server";
import { submit } from "@/lib/textile/client";
import { textileErrorResponse } from "@/lib/textile/http";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.rfqId !== "string" || typeof b.claimToken !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash ?? ""))
    return NextResponse.json({ error: "rfqId, claimToken and txHash are required" }, { status: 400 });
  try {
    return NextResponse.json({ data: await submit(b.rfqId, b.claimToken, b.txHash) });
  } catch (e) {
    return textileErrorResponse(e);
  }
}
