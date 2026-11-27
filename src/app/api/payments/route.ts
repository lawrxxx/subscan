import { NextResponse } from "next/server";
import { paymentToRow, rowToPayment } from "@/lib/db/repo";
import { PaymentIn } from "@/lib/db/schema";
import { dbError, parseBody } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

// Upsert a payment record. A record can never be downgraded from confirmed, and
// "confirmed" requires every step to carry a transaction hash.
export async function PUT(req: Request) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const b = await parseBody(req, PaymentIn);
  if (!b.ok) return b.res;
  const p = b.data;
  if (p.status === "confirmed" && p.steps.some((s) => s.status === "confirmed" && !s.hash && s.kind !== "approval"))
    return NextResponse.json({ error: "A confirmed payment needs on-chain transaction hashes" }, { status: 422 });
  try {
    const { data: existing } = await a.supabase.from("subscan_payments").select("status").eq("id", p.id).maybeSingle();
    if (existing?.status === "confirmed" && p.status !== "confirmed") return NextResponse.json({ error: "Confirmed payments cannot change" }, { status: 409 });
    const { data, error } = await a.supabase.from("subscan_payments").upsert(paymentToRow(p, a.user.id), { onConflict: "id" }).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: rowToPayment(data) });
  } catch (e) {
    return dbError(e);
  }
}
