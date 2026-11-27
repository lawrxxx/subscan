import { NextResponse } from "next/server";
import { clearData, loadState } from "@/lib/db/repo";
import { dbError } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  try {
    const state = await loadState(a.supabase, a.user.id, { transactions: true });
    return NextResponse.json({ data: { ...state, user: { id: a.user.id, email: a.user.email } } });
  } catch (e) {
    return dbError(e);
  }
}

export async function DELETE() {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  try {
    await clearData(a.supabase, a.user.id);
    return NextResponse.json({ data: { cleared: true } });
  } catch (e) {
    return dbError(e);
  }
}
