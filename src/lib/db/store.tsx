"use client";
// Application state: subscriptions, imported transactions, payment records and
// preferences. Persisted through a StorageAdapter (browser localStorage today).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { parseTransactionsCsv } from "../detection/csv";
import { sampleStatementCsv } from "../sample";
import type { AppSettings, AppState, PaymentRecord, Subscription, Transaction } from "../types";
import { browserStorage, type StorageAdapter } from "./storage";

const EMPTY: AppState = {
  transactions: [],
  subscriptions: [],
  payments: [],
  settings: { homeCurrency: "NGN", payGasInUsdt: false },
};

/** "Lapsed" depends on today's date, so it is recomputed on every load. */
function withLapsed(subs: Subscription[]): Subscription[] {
  const now = Date.now();
  return subs.map((s) => ({ ...s, lapsed: (now - Date.parse(`${s.lastCharge}T00:00:00Z`)) / 86_400_000 > s.intervalDays * 2.2 }));
}

interface Store {
  ready: boolean;
  storage: StorageAdapter["kind"];
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

export function StoreProvider({ children, adapter = browserStorage }: { children: ReactNode; adapter?: StorageAdapter }) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    let live = true;
    adapter.load().then((saved) => {
      if (!live) return;
      if (saved) setState({ ...EMPTY, ...saved, subscriptions: withLapsed(saved.subscriptions ?? []), settings: { ...EMPTY.settings, ...saved.settings } });
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [adapter]);

  const commit = useCallback(
    (fn: (s: AppState) => AppState) => {
      const next = fn(ref.current);
      ref.current = next;
      setState(next);
      void adapter.save(next);
    },
    [adapter],
  );

  const store = useMemo<Store>(() => {
    const importTransactions = (txs: Transaction[], source: "csv" | "sample") => {
      const fresh = detectSubscriptions(txs, { homeCurrency: ref.current.settings.homeCurrency });
      const merged = mergeWithPrevious(fresh, ref.current.dataSource === source ? ref.current.subscriptions : []);
      commit((s) => ({ ...s, transactions: txs, subscriptions: merged, importedAt: new Date().toISOString(), dataSource: source }));
      return merged;
    };
    return {
      ready,
      storage: adapter.kind,
      state,
      importTransactions,
      loadSample() {
        const { transactions } = parseTransactionsCsv(sampleStatementCsv(), ref.current.settings.homeCurrency, "sample");
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
          // Never downgrade a confirmed on-chain record.
          if (exists && s.payments.find((x) => x.id === p.id)!.status === "confirmed" && p.status !== "confirmed") return s;
          return { ...s, payments: exists ? s.payments.map((x) => (x.id === p.id ? p : x)) : [p, ...s.payments] };
        });
      },
      removePayment(id) {
        commit((s) => ({ ...s, payments: s.payments.filter((x) => x.id !== id || x.status !== "prepared") }));
      },
      reset() {
        // Keep preferences and records of on-chain payments; drop imports and drafts.
        commit((s) => ({ ...EMPTY, settings: s.settings, payments: s.payments.filter((p) => p.status !== "prepared") }));
      },
    };
  }, [ready, adapter.kind, state, commit]);

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
