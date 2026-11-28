// Loading saved data, including data from older versions. Pure.
import type { Activity, AppSettings, AppState, PaymentWalletState } from "../types.ts";

export const EMPTY: AppState = { version: 2, settings: { payGasInUsdt: false }, recipients: [], rules: [], schedules: [], activity: [] };

interface LegacyPayment {
  id: string;
  createdAt: string;
  merchant: string;
  destinationToken: "USDT" | "cNGN";
  destinationAmount: string;
  recipient?: `0x${string}`;
  status: string;
  steps?: { kind: string; hash?: `0x${string}` }[];
}

/**
 * Bring data from older versions forward. Data the app no longer uses is dropped;
 * confirmed on-chain payments are kept as completed transfers so the history stays honest.
 */
export function migrate(saved: Record<string, unknown> | null): AppState {
  if (!saved) return EMPTY;
  if (saved.version === 2) {
    const s = saved as unknown as AppState;
    return { ...EMPTY, ...s, settings: { ...EMPTY.settings, ...s.settings } };
  }
  const settings = (saved.settings ?? {}) as AppSettings & Record<string, unknown>;
  const old = (saved.autopilot ?? undefined) as (PaymentWalletState & { recipients?: unknown }) | undefined;
  const payments = (Array.isArray(saved.payments) ? saved.payments : []) as LegacyPayment[];
  const activity: Activity[] = payments
    .filter((p) => p.status === "confirmed")
    .map((p) => {
      const hash = p.steps?.find((x) => x.kind === "settlement")?.hash ?? p.steps?.find((x) => x.hash)?.hash;
      return { id: p.id, kind: "transfer" as const, status: "completed" as const, createdAt: p.createdAt, updatedAt: p.createdAt, key: `legacy:${p.id}`, token: p.destinationToken, amount: p.destinationAmount, recipient: p.recipient, recipientName: p.merchant, txHash: hash, note: "Recorded before this update" };
    });
  return {
    ...EMPTY,
    settings: { payGasInUsdt: !!settings.payGasInUsdt, wallet: settings.wallet, agentId: settings.agentId, agentRegistrationTx: settings.agentRegistrationTx, displayName: settings.displayName },
    autopilot: old?.wallet ? { wallet: old.wallet, passkey: old.passkey, enabled: false, sealedPolicy: old.sealedPolicy, agentPublicKey: old.agentPublicKey, limits: old.limits ?? { USDT: "20", cNGN: "30000" }, expiry: old.expiry, grantTx: old.grantTx, grantedAt: old.grantedAt, revokedAt: old.revokedAt, revokeTx: old.revokeTx, templateVersion: 1 } : undefined,
    activity,
  };
}

