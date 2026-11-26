import { NextResponse } from "next/server";
import { pay, probe } from "@/lib/merchant/x402-server";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (typeof b.url !== "string") return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    if (b.mode === "pay") return NextResponse.json({ data: await pay(b.url, b.headers ?? {}) });
    return NextResponse.json({ data: await probe(b.url) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "x402 request failed" }, { status: 400 });
  }
}
