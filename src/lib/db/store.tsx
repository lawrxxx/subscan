"use client";
// Application state.
//  - Account mode (Supabase configured): the database is the source of truth.
//    Every change goes through a validated API route; the UI updates
//    optimistically and rolls back if the server rejects it.
//  - Guest mode (no Supabase): state lives in this browser's localStorage only.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { parseTransactionsCsv } from "../detection/csv";
import { sampleStatementCsv } from "../sample";
import { browserSupabase } from "../supabase/browser";
import { supabaseConfigured } from "../supabase/env";
import type { AppSettings, AppState, PaymentRecord, Subscription, Transaction } from "../types";

const KEY = "subscan:v1";

const EMPTY: AppState = {
  transactions: [],
  subscriptions: [],
  payments: [],
  settings: { homeCurrency: "NGN", payGasInUsdt: false },
};

function withLapsed(subs: Subscription[]): Subscription[] {
  const now = Date.now();
  return subs.map((s) => ({ ...s, lapsed: (now - Date.parse(`${s.lastCharge}T00:00:00Z`)) / 86_400_000 > s.intervalDays * 2.2 }));
}

function loadLocal(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as AppState;
    return { ...EMPTY, ...parsed, subscriptions: withLapsed(parsed.subscriptions ?? []), settings: { ...EMPTY.settings, ...parsed.settings } };
  } catch {
    return EMPTY;
  }
}

function saveLocal(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const PUBLIC_PATHS = ["/login", "/signup", "/reset", "/auth"];
const onPublicPage = () => typeof window !== "undefined" && PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && typeof window !== "undefined" && !onPublicPage()) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j.data as T;
}

export type StoreMode = "account" | "guest";

interface Store {
  ready: boolean;
  mode: StoreMode;
  user?: { id: string; email?: string };
  state: AppState & { transactionCount?: number };
  syncing: boolean;
  error?: string;
  loadError?: string;
  clearError(): void;
  reload(): Promise<void>;
  importTransactions(txs: Transaction[], source: "csv" | "sample"): Subscription[];
  loadSample(): Subscription[];
  updateSubscription(id: string, patch: Partial<Subscription>): void;
  updateSettings(patch: Partial<AppSettings>): void;
  upsertPayment(p: PaymentRecord): void;
  removePayment(id: string): void;
  reset(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const mode: StoreMode = supabaseConfigured ? "account" : "guest";
  const [state, setState] = useState<AppState & { transactionCount?: number }>(EMPTY);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Store["user"]>();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const stateRef = useRef(state);
  stateRef.current = state;
  // Writes are serialised so rapid updates (e.g. payment steps) land in order.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    if (mode === "guest") {
      setState(loadLocal());
      setReady(true);
      return;
    }
    if (onPublicPage()) {
      // Signed-out pages: nothing to load.
      setReady(true);
      return;
    }
    try {
      const data = await api<AppState & { transactionCount: number; user: { id: string; email?: string } }>("/api/state");
      setUser(data.user);
      setState({ ...data, subscriptions: withLapsed(data.subscriptions) });
      setLoadError(undefined);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, [mode]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    void reload();
  }, [reload]);

  /** Apply a change locally, then (in account mode) persist it; roll back on failure. */
  const mutate = useCallback(
    (fn: (s: AppState) => AppState, persist?: () => Promise<void>) => {
      const before = stateRef.current;
      const next = fn(before);
      stateRef.current = next;
      setState(next);
      if (mode === "guest") {
        saveLocal(next);
        return;
      }
      if (!persist) return;
      setPending((n) => n + 1);
      queue.current = queue.current
        .then(persist)
        .catch((e) => {
          // Server rejected the change: show why and resync from the database.
          setError(e instanceof Error ? e.message : String(e));
          stateRef.current = before;
          setState(before);
          void reloadRef.current();
        })
        .finally(() => setPending((n) => n - 1));
    },
    [mode],
  );

  const store = useMemo<Store>(() => {
    const importTransactions = (txs: Transaction[], source: "csv" | "sample") => {
      const cur = stateRef.current;
      const fresh = detectSubscriptions(txs, { homeCurrency: cur.settings.homeCurrency });
      const merged = mergeWithPrevious(fresh, cur.subscriptions);
      mutate(
        (s) => ({ ...s, transactions: txs, transactionCount: txs.length, subscriptions: merged, importedAt: new Date().toISOString(), dataSource: source }),
        async () => {
          const r = await api<{ subscriptions: Subscription[]; transactionCount: number }>("/api/import", { method: "POST", body: JSON.stringify({ source, transactions: txs }) });
          setState((s) => ({ ...s, subscriptions: withLapsed(r.subscriptions), transactionCount: r.transactionCount }));
        },
      );
      return merged;
    };
    return {
      ready,
      mode,
      user,
      state,
      syncing: pending > 0,
      error,
      loadError,
      clearError: () => setError(undefined),
      reload,
      importTransactions,
      loadSample() {
        const { transactions } = parseTransactionsCsv(sampleStatementCsv(), stateRef.current.settings.homeCurrency, "sample");
        return importTransactions(transactions, "sample");
      },
      updateSubscription(id, patch) {
        mutate(
          (s) => ({ ...s, subscriptions: s.subscriptions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
          async () => {
            const body: Record<string, unknown> = {};
            for (const k of ["status", "displayName", "category", "amount", "frequency", "intervalDays", "nextRenewal", "edited"] as const) if (patch[k] !== undefined) body[k] = patch[k];
            if ("payment" in patch) body.payment = patch.payment ?? null;
            await api(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
          },
        );
      },
      updateSettings(patch) {
        mutate(
          (s) => ({ ...s, settings: { ...s.settings, ...patch } }),
          async () => {
            const body: Record<string, unknown> = {};
            if ("homeCurrency" in patch) body.homeCurrency = patch.homeCurrency;
            if ("payGasInUsdt" in patch) body.payGasInUsdt = patch.payGasInUsdt;
            if ("wallet" in patch) body.wallet = patch.wallet ?? null;
            if ("agentId" in patch) body.agentId = patch.agentId ?? null;
            if ("agentRegistrationTx" in patch) body.agentRegistrationTx = patch.agentRegistrationTx ?? null;
            if ("displayName" in patch) body.displayName = patch.displayName ?? null;
            if ("onboarded" in patch) body.onboarded = patch.onboarded;
            if (Object.keys(body).length) await api("/api/profile", { method: "PATCH", body: JSON.stringify(body) });
          },
        );
      },
      upsertPayment(p) {
        mutate(
          (s) => {
            const exists = s.payments.some((x) => x.id === p.id);
            return { ...s, payments: exists ? s.payments.map((x) => (x.id === p.id ? p : x)) : [p, ...s.payments] };
          },
          async () => {
            await api("/api/payments", { method: "PUT", body: JSON.stringify(p) });
          },
        );
      },
      removePayment(id) {
        mutate(
          (s) => ({ ...s, payments: s.payments.filter((x) => x.id !== id || x.status !== "prepared") }),
          async () => {
            await api(`/api/payments/${encodeURIComponent(id)}`, { method: "DELETE" });
          },
        );
      },
      async reset() {
        if (mode === "guest") {
          const next = { ...EMPTY, settings: stateRef.current.settings };
          setState(next);
          saveLocal(next);
          return;
        }
        await api("/api/state", { method: "DELETE" });
        await reload();
      },
      async signOut() {
        await browserSupabase()?.auth.signOut();
        window.location.href = "/login";
      },
    };
  }, [ready, mode, user, state, pending, error, loadError, reload, mutate]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Live indicative USD→NGN rate from Textile FX, used only to total mixed-currency spend. */
export function useRates(home: string) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<{ asOf?: string; error?: string }>({});
  useEffect(() => {
    if (home !== "NGN") return;
    let cancelled = false;
    fetch("/api/fx/rate")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.data) {
          setRates({ USD: j.data.ngnPerUsd });
          setMeta({ asOf: j.data.asOf });
        } else setMeta({ error: j.error });
      })
      .catch((e) => !cancelled && setMeta({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [home]);
  return { rates, ...meta };
}
