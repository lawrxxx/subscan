"use client";
// Application state: subscriptions, imported transactions, payment records and
// preferences. Persisted through a StorageAdapter (browser localStorage today).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { extractCsv } from "../import/csv";
import { mergeTransactions, rowsToTransactions } from "../import/normalise";
import type { ExtractedRow } from "../import/types";
import { sampleStatementCsv } from "../sample";
import type { AppSettings, AppState, ImportRecord, PaymentRecord, Subscription } from "../types";
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
  return subs.map((s) => ({ ...s, lapsed: !s.manual && (now - Date.parse(`${s.lastCharge}T00:00:00Z`)) / 86_400_000 > s.intervalDays * 2.2 }));
}

interface Store {
  ready: boolean;
  storage: StorageAdapter["kind"];
  state: AppState;
  /** Save reviewed rows: de-duplicate against existing data, then re-run detection. */
  importRows(rows: ExtractedRow[], meta: { fileName: string; format: string; source: "csv" | "pdf" | "sample" }): { record: ImportRecord; subscriptions: Subscription[] };
  loadSample(): Subscription[];
  removeImport(importId: string): void;
  addManual(sub: Subscription): void;
  removeSubscription(id: string): void;
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
    const redetect = (txs: AppState["transactions"], previous: Subscription[]) => {
      const fresh = detectSubscriptions(txs, { homeCurrency: ref.current.settings.homeCurrency });
      return mergeWithPrevious(fresh, previous);
    };
    const importRows: Store["importRows"] = (rows, meta) => {
      const cur = ref.current;
      const id = `imp_${Date.now().toString(36)}`;
      const incoming = rowsToTransactions(rows, meta.source, id);
      // Real data replaces the sample statement rather than mixing with it.
      const replacing = meta.source === "sample" || cur.dataSource === "sample";
      const base = replacing ? [] : cur.transactions;
      const { merged, added, duplicates } = mergeTransactions(base, incoming);
      const subs = redetect(merged, replacing ? cur.subscriptions.filter((x) => x.manual) : cur.subscriptions);
      const dates = incoming.map((t) => t.date).sort();
      const record: ImportRecord = { id, at: new Date().toISOString(), fileName: meta.fileName, format: meta.format, rows: added, duplicates, from: dates[0], to: dates[dates.length - 1] };
      commit((s) => ({
        ...s,
        transactions: merged,
        subscriptions: subs,
        importedAt: record.at,
        dataSource: meta.source,
        imports: [record, ...(replacing ? [] : (s.imports ?? []))].slice(0, 20),
      }));
      return { record, subscriptions: subs };
    };
    return {
      ready,
      storage: adapter.kind,
      state,
      importRows,
      loadSample() {
        const r = extractCsv(sampleStatementCsv(), ref.current.settings.homeCurrency);
        return importRows(r.rows, { fileName: "Sample statement", format: "CSV", source: "sample" }).subscriptions;
      },
      removeImport(importId) {
        const cur = ref.current;
        const txs = cur.transactions.filter((t) => !t.id.startsWith(`${importId}-`));
        const subs = redetect(txs, cur.subscriptions);
        commit((s) => ({ ...s, transactions: txs, subscriptions: subs, imports: (s.imports ?? []).filter((i) => i.id !== importId) }));
      },
      removeSubscription(id) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id || !x.manual) }));
      },
      addManual(sub) {
        commit((s) => ({ ...s, subscriptions: [...s.subscriptions.filter((x) => x.id !== sub.id), sub] }));
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
