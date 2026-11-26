import { NextResponse } from "next/server";
import { indicativeUsdNgn } from "@/lib/textile/rate";

export async function GET() {
  try {
    return NextResponse.json({ data: await indicativeUsdNgn() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "rate unavailable" }, { status: 502 });
  }
}
