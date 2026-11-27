import { NextResponse } from "next/server";
import { importTransactions } from "@/lib/db/repo";
import { ImportIn } from "@/lib/db/schema";
import { dbError, parseBody } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

export const maxDuration = 60;

// Stores imported transactions and runs subscription detection server-side.
export async function POST(req: Request) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const b = await parseBody(req, ImportIn);
  if (!b.ok) return b.res;
  try {
    const { data: profile } = await a.supabase.from("subscan_profiles").select("home_currency").eq("id", a.user.id).maybeSingle();
    const subs = await importTransactions(a.supabase, a.user.id, b.data.transactions, b.data.source, profile?.home_currency ?? "NGN");
    return NextResponse.json({ data: { subscriptions: subs, transactionCount: b.data.transactions.length } });
  } catch (e) {
    return dbError(e);
  }
}
