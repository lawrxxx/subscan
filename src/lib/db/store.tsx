"use client";
// App state lives in the browser (localStorage) by default: imported statements
// never leave the device except when the agent is asked a question (the
// subscription summary is sent to the server for that request only). Payment
// records are additionally mirrored to Supabase when it is configured.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { parseTransactionsCsv } from "../detection/csv";
import { sampleStatementCsv } from "../sample";
import type { AppSettings, AppState, PaymentRecord, Subscription, Transaction } from "../types";

const KEY = "subscan:v1";

const EMPTY: AppState = {
  transactions: [],
  subscriptions: [],
  payments: [],
  settings: { homeCurrency: "NGN", payGasInUsdt: false },
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as AppState;
    // Recompute "lapsed" so stored detections age correctly between visits.
    const now = Date.now();
    const subscriptions = (parsed.subscriptions ?? []).map((s) => ({
      ...s,
      lapsed: (now - Date.parse(`${s.lastCharge}T00:00:00Z`)) / 86_400_000 > s.intervalDays * 2.2,
    }));
    return { ...EMPTY, ...parsed, subscriptions, settings: { ...EMPTY.settings, ...parsed.settings } };
  } catch {
    return EMPTY;
  }
}

function save(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — state stays in memory */
  }
}

async function mirrorPayment(p: PaymentRecord) {
  try {
    await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  } catch {
    /* optional */
  }
}

interface Store {
  ready: boolean;
  state: AppState;
  importTransactions(txs: Transaction[], source: "csv" | "sample"): Subscription[];
  loadSample(): Subscription[];
  updateSubscription(id: string, patch: Partial<Subscription>): void;
  updateSettings(patch: Partial<AppSettings>): void;
  upsertPayment(p: PaymentRecord): void;
  removePayment(id: string): void;
  reset(): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);

  const commit = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const store = useMemo<Store>(() => {
    const importTransactions = (txs: Transaction[], source: "csv" | "sample") => {
      const fresh = detectSubscriptions(txs, { homeCurrency: state.settings.homeCurrency });
      const merged = mergeWithPrevious(fresh, state.dataSource === source ? state.subscriptions : []);
      commit((s) => ({ ...s, transactions: txs, subscriptions: merged, importedAt: new Date().toISOString(), dataSource: source }));
      return merged;
    };
    return {
      ready,
      state,
      importTransactions,
      loadSample() {
        const { transactions } = parseTransactionsCsv(sampleStatementCsv(), state.settings.homeCurrency, "sample");
        return importTransactions(transactions, "sample");
      },
      updateSubscription(id, patch) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      },
      updateSettings(patch) {
        commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      },
      upsertPayment(p) {
        commit((s) => {
          const exists = s.payments.some((x) => x.id === p.id);
          return { ...s, payments: exists ? s.payments.map((x) => (x.id === p.id ? p : x)) : [p, ...s.payments] };
        });
        if (p.status !== "prepared") void mirrorPayment(p);
      },
      removePayment(id) {
        commit((s) => ({ ...s, payments: s.payments.filter((x) => x.id !== id || x.status !== "prepared") }));
      },
      reset() {
        commit(() => ({ ...EMPTY, settings: state.settings }));
      },
    };
  }, [ready, state, commit]);

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
