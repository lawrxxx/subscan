"use client";
// Keep the server's sealed checks in step with what the user set here: the saved,
// confirmed recipients and the per-transfer cap (the stricter of the payment
// wallet's cap and any "never above" money rule).
import { updatePolicy } from "../autopilot/browser";
import type { useStore } from "../db/store";
import { transferCap } from "./rules";

type StoreApi = ReturnType<typeof useStore>;

export function desiredPolicy(s: ReturnType<StoreApi["get"]>) {
  const recipients = s.recipients.filter((r) => r.confirmedAt).map((r) => ({ address: r.address, label: r.name }));
  const maxPerTransfer: { USDT?: string; cNGN?: string } = {};
  for (const t of ["USDT", "cNGN"] as const) {
    const wallet = Number(s.autopilot?.maxPerTransfer?.[t]) || undefined;
    const rule = transferCap(s.rules, t);
    const v = wallet && rule ? Math.min(wallet, rule) : wallet ?? rule;
    if (v) maxPerTransfer[t] = String(v);
  }
  return { recipients, maxPerTransfer };
}

/** Re-seal the policy on the server. No-op without access. Throws on failure so callers can say so. */
export async function syncPolicy(store: StoreApi) {
  const s = store.get();
  const ap = s.autopilot;
  if (!ap?.sealedPolicy || ap.revokedAt) return;
  const { sealedPolicy } = await updatePolicy(ap.sealedPolicy, ap.wallet, desiredPolicy(s));
  store.setAutopilot({ sealedPolicy });
}
