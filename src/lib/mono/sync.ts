import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importTransactions } from "../db/repo.ts";
import { accountCurrency, fetchTransactions } from "./client.ts";

/** Pull transactions for a linked account and run detection for its owner. */
export async function syncLink(db: SupabaseClient, link: { id: string; user_id: string; account_id: string }) {
  try {
    const currency = await accountCurrency(link.account_id);
    const txs = await fetchTransactions(link.account_id, currency);
    if (!txs.length) {
      await db.from("subscan_mono_links").update({ last_error: "No debit transactions returned yet", last_synced_at: new Date().toISOString() }).eq("id", link.id);
      return { imported: 0, subscriptions: 0 };
    }
    const { data: profile } = await db.from("subscan_profiles").select("home_currency").eq("id", link.user_id).maybeSingle();
    const subs = await importTransactions(db, link.user_id, txs, "mono", profile?.home_currency ?? "NGN");
    await db.from("subscan_mono_links").update({ status: "synced", last_error: null, last_synced_at: new Date().toISOString() }).eq("id", link.id);
    return { imported: txs.length, subscriptions: subs.length };
  } catch (e) {
    await db.from("subscan_mono_links").update({ last_error: (e as Error).message.slice(0, 300) }).eq("id", link.id);
    throw e;
  }
}
