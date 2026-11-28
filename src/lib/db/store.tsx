"use client";
// Application state: the payment wallet, saved recipients, money rules, transfer
// schedules and the activity log. Persisted in this browser through a
// StorageAdapter. Nothing is ever seeded: a new user starts empty.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Activity, AppSettings, AppState, MoneyRule, PaymentWalletState, Recipient, TransferSchedule } from "../types";
import { EMPTY, migrate } from "./migrate";
export { EMPTY, migrate };
import { browserStorage, purgeLegacyKeys, USER_KEY, type StorageAdapter } from "./storage";

interface Store {
  ready: boolean;
  state: AppState;
  /** The current state, including changes made since the last render. */
  get(): AppState;
  updateSettings(patch: Partial<AppSettings>): void;
  setAutopilot(patch: Partial<PaymentWalletState> | null): void;
  upsertRecipient(r: Recipient): void;
  removeRecipient(id: string): void;
  upsertRule(r: MoneyRule): void;
  removeRule(id: string): void;
  upsertSchedule(s: TransferSchedule): void;
  /** Insert or replace by id. A completed record is never downgraded. */
  upsertActivity(a: Activity): void;
  patchActivity(id: string, patch: Partial<Activity>): void;
  dismissLegacyNotice(): void;
  reset(): void;
}

const Ctx = createContext<Store | null>(null);
const now = () => new Date().toISOString();

export function StoreProvider({ children, adapter: given }: { children: ReactNode; adapter?: StorageAdapter }) {
  // One adapter for the provider's lifetime — a new one each render would re-run the load effect forever.
  const [adapter] = useState<StorageAdapter>(() => given ?? browserStorage(USER_KEY));
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    let live = true;
    purgeLegacyKeys();
    adapter.load().then((saved) => {
      if (!live) return;
      const loaded = migrate(saved as unknown as Record<string, unknown> | null);
      if (saved && (saved as { version?: number }).version !== 2) void adapter.save(loaded);
      setState(loaded);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [adapter]);

  // Another tab changed the data: pick it up so two tabs never act on stale state.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== USER_KEY || !e.newValue) return;
      try {
        const next = migrate(JSON.parse(e.newValue));
        ref.current = next;
        setState(next);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback(
    (fn: (s: AppState) => AppState) => {
      const next = fn(ref.current);
      ref.current = next;
      setState(next);
      void adapter.save(next);
    },
    [adapter],
  );

  const store = useMemo<Store>(
    () => ({
      ready,
      state,
      get: () => ref.current,
      updateSettings: (patch) => commit((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
      setAutopilot: (patch) => commit((s) => ({ ...s, autopilot: patch === null ? undefined : ({ ...(s.autopilot ?? {}), ...patch } as PaymentWalletState) })),
      upsertRecipient: (r) =>
        commit((s) => {
          const old = s.recipients.find((x) => x.id === r.id);
          // Never silently change a confirmed address: a different address is a new recipient.
          if (old?.confirmedAt && old.address.toLowerCase() !== r.address.toLowerCase()) return s;
          return { ...s, recipients: old ? s.recipients.map((x) => (x.id === r.id ? r : x)) : [...s.recipients, r] };
        }),
      removeRecipient: (id) =>
        commit((s) => ({
          ...s,
          recipients: s.recipients.filter((x) => x.id !== id),
          schedules: s.schedules.map((x) => (x.recipientId === id && x.status !== "cancelled" && x.status !== "ended" ? { ...x, status: "cancelled", updatedAt: now() } : x)),
        })),
      upsertRule: (r) => commit((s) => ({ ...s, rules: s.rules.some((x) => x.id === r.id) ? s.rules.map((x) => (x.id === r.id ? r : x)) : [...s.rules, r] })),
      removeRule: (id) => commit((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== id) })),
      upsertSchedule: (sc) => commit((s) => ({ ...s, schedules: s.schedules.some((x) => x.id === sc.id) ? s.schedules.map((x) => (x.id === sc.id ? sc : x)) : [...s.schedules, sc] })),
      upsertActivity: (a) =>
        commit((s) => {
          const existing = s.activity.find((x) => x.id === a.id);
          if (existing?.status === "completed" && a.status !== "completed") return s;
          return { ...s, activity: existing ? s.activity.map((x) => (x.id === a.id ? a : x)) : [a, ...s.activity].slice(0, 500) };
        }),
      patchActivity: (id, patch) =>
        commit((s) => ({
          ...s,
          activity: s.activity.map((x) => (x.id !== id || (x.status === "completed" && patch.status && patch.status !== "completed") ? x : { ...x, ...patch, updatedAt: now() })),
        })),
      dismissLegacyNotice: () => commit((s) => ({ ...s, legacyCleared: undefined })),
      reset: () => commit((s) => ({ ...EMPTY, settings: s.settings, autopilot: s.autopilot, activity: s.activity.filter((a) => a.txHash) })),
    }),
    [ready, state, commit],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

