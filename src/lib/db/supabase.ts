// Optional server-side persistence of payment receipts in Supabase.
// Enabled only when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRecord } from "../types.ts";

let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

export async function savePaymentRecord(p: PaymentRecord) {
  const db = supabase();
  if (!db) return { stored: false as const, reason: "supabase not configured" };
  const { error } = await db.from("payment_records").upsert(
    {
      id: p.id,
      created_at: p.createdAt,
      wallet: p.from?.toLowerCase() ?? null,
      subscription_id: p.subscriptionId,
      merchant: p.merchant,
      source_token: p.sourceToken,
      destination_token: p.destinationToken,
      source_amount: p.sourceAmount,
      destination_amount: p.destinationAmount,
      fee_amount: p.feeAmount ?? null,
      rate: p.rate ?? null,
      recipient: p.recipient ?? null,
      method: p.method,
      rfq_id: p.rfqId ?? null,
      status: p.status,
      steps: p.steps,
    },
    { onConflict: "id" },
  );
  if (error) return { stored: false as const, reason: error.message };
  return { stored: true as const };
}
