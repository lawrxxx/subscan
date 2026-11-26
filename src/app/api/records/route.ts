import { NextResponse } from "next/server";
import { savePaymentRecord } from "@/lib/db/supabase";
import type { PaymentRecord } from "@/lib/types";

export async function POST(req: Request) {
  const p = (await req.json().catch(() => null)) as PaymentRecord | null;
  if (!p?.id || !Array.isArray(p.steps)) return NextResponse.json({ error: "invalid record" }, { status: 400 });
  return NextResponse.json({ data: await savePaymentRecord(p) });
}
