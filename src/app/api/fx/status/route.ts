import { NextResponse } from "next/server";
import { status } from "@/lib/textile/client";
import { textileErrorResponse } from "@/lib/textile/http";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.rfqId !== "string" || typeof b.claimToken !== "string") return NextResponse.json({ error: "rfqId and claimToken required" }, { status: 400 });
  try {
    return NextResponse.json({ data: await status(b.rfqId, b.claimToken) });
  } catch (e) {
    return textileErrorResponse(e);
  }
}
