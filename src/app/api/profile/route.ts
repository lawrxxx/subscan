import { NextResponse } from "next/server";
import { profileToSettings } from "@/lib/db/repo";
import { ProfilePatch } from "@/lib/db/schema";
import { dbError, parseBody } from "@/lib/db/http";
import { requireUser } from "@/lib/supabase/server";

export async function PATCH(req: Request) {
  const a = await requireUser();
  if (a instanceof NextResponse) return a;
  const b = await parseBody(req, ProfilePatch);
  if (!b.ok) return b.res;
  const p = b.data;
  const row: Record<string, unknown> = { id: a.user.id };
  if (p.displayName !== undefined) row.display_name = p.displayName || null;
  if (p.homeCurrency !== undefined) row.home_currency = p.homeCurrency;
  if (p.payGasInUsdt !== undefined) row.pay_gas_in_usdt = p.payGasInUsdt;
  if (p.wallet !== undefined) row.wallet_address = p.wallet;
  if (p.agentId !== undefined) row.agent_id = p.agentId;
  if (p.agentRegistrationTx !== undefined) row.agent_registration_tx = p.agentRegistrationTx;
  if (p.onboarded !== undefined) row.onboarded = p.onboarded;
  try {
    const { data, error } = await a.supabase.from("subscan_profiles").upsert(row, { onConflict: "id" }).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: profileToSettings(data) });
  } catch (e) {
    return dbError(e);
  }
}
