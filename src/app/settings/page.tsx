"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { PageHeader } from "@/components/shell";

interface Status {
  celoRpc: { ok: boolean; block?: string; error?: string };
  textile: { ok: boolean; ngnPerUsd?: number; auth?: string; error?: string };
  agent: { llm: boolean; model: string };
  supabase: boolean;
  mono: boolean;
}

export default function Settings() {
  const { state, updateSettings, reset, loadSample } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j) => setStatus(j.data)).catch(() => setStatus(null));
  }, []);

  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(undefined), 1800);
  };

  return (
    <div>
      <PageHeader kicker="Settings" title="Preferences and data">
        How subscan calculates totals, pays network fees and stores what you import.
      </PageHeader>

      <Section title="Preferences" note="Applied immediately and saved on this device.">
        <Field label="Home currency" hint="Totals are shown in this currency. Foreign-currency subscriptions are converted at a live Textile FX rate where one exists.">
          <div className="flex gap-px">
            {["NGN", "USD"].map((c) => (
              <button key={c} onClick={() => { updateSettings({ homeCurrency: c }); flash("Home currency updated"); }} className={`border px-4 py-2 text-[14px] ${state.settings.homeCurrency === c ? "border-ink bg-ink text-paper" : "rule text-muted hover:text-ink"}`}>
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Network fees" hint={`Pay gas in USD₮ through Celo fee abstraction (CIP-64 adapter ${TOKENS.USDT.feeCurrencyAdapter}). MiniPay supports it; other wallets may still charge CELO.`}>
          <label className="flex items-center gap-3 text-[14px]">
            <button role="switch" aria-checked={state.settings.payGasInUsdt} onClick={() => { updateSettings({ payGasInUsdt: !state.settings.payGasInUsdt }); flash("Fee preference updated"); }} className={`relative h-6 w-11 border transition-colors ${state.settings.payGasInUsdt ? "border-accent bg-accent" : "rule bg-stone"}`}>
              <span className={`absolute top-[3px] h-4 w-4 bg-paper transition-all ${state.settings.payGasInUsdt ? "left-[22px]" : "left-[3px]"}`} />
            </button>
            {state.settings.payGasInUsdt ? "Pay network fees in USD₮" : "Pay network fees in CELO"}
          </label>
        </Field>
        {saved && <p className="text-[13px] text-accent" role="status">{saved}</p>}
      </Section>

      <Section title="Integrations" note="Live status of the services subscan depends on.">
        <ul className="border-t border-ink text-[14px]">
          <Integration name="Celo mainnet RPC" ok={status?.celoRpc.ok} detail={status ? (status.celoRpc.ok ? `Connected · block ${status.celoRpc.block}` : "Unreachable") : undefined} />
          <Integration name="Textile FX · USD₮ ↔ cNGN" ok={status?.textile.ok} detail={status ? (status.textile.ok ? `Live · 1 USD₮ ≈ ₦${status.textile.ngnPerUsd?.toFixed(2)}` : "Unreachable") : undefined} />
          <Integration name="Agent model" ok={status?.agent.llm} warn detail={status ? (status.agent.llm ? `${status.agent.model} with tools` : "Local intent mode — same tools, no language model") : undefined} />
          <Integration name="Receipt backup (Supabase)" ok={status?.supabase} warn detail={status ? (status.supabase ? "Mirroring payment records" : "Off — receipts stay on this device") : undefined} />
          <Integration name="Bank linking (Mono)" ok={false} warn detail="Not available yet — import a CSV statement" />
        </ul>
      </Section>

      <Section title="Your data" note="Everything below is stored in this browser only.">
        <dl className="grid max-w-2xl grid-cols-2 border-t border-ink text-[14px] sm:grid-cols-4">
          {[
            ["Source", state.dataSource === "sample" ? "Sample statement" : state.dataSource === "csv" ? "Your CSV" : "None"],
            ["Imported", state.importedAt ? date(state.importedAt.slice(0, 10)) : "—"],
            ["Transactions", String(state.transactions.length)],
            ["Payment records", String(state.payments.length)],
          ].map(([k, v]) => (
            <div key={k} className="border-b rule py-3 pr-3">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="num mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/onboarding" className="btn btn-ghost">Import a new statement</Link>
          {state.dataSource !== "sample" && <button className="btn btn-ghost" onClick={() => { loadSample(); flash("Sample data loaded"); }}>Load sample data</button>}
          {!confirmReset ? (
            <button className="btn btn-ghost text-alert" onClick={() => setConfirmReset(true)}>Clear all data</button>
          ) : (
            <span className="flex flex-wrap items-center gap-3">
              <button className="btn bg-alert text-paper" onClick={() => { reset(); setConfirmReset(false); flash("All data cleared"); }}>Yes, clear everything</button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </span>
          )}
        </div>
        <p className="mt-3 max-w-xl text-[12px] text-muted">Clearing removes imported transactions, detected subscriptions and local payment records. On-chain transactions are permanent and are not affected.</p>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-b rule px-4 py-10 sm:px-8 lg:grid-cols-[280px_1fr] lg:px-12">
      <div>
        <h2 className="display text-[26px]">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{note}</p>
      </div>
      <div className="space-y-8">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl border-t rule pt-4">
      <div className="mb-1 text-[14px] font-medium">{label}</div>
      <p className="mb-3 text-[12px] text-muted break-words">{hint}</p>
      {children}
    </div>
  );
}

function Integration({ name, ok, detail, warn }: { name: string; ok?: boolean; detail?: string; warn?: boolean }) {
  const dot = ok === undefined ? "bg-stone" : ok ? "bg-accent" : warn ? "bg-amber" : "bg-alert";
  return (
    <li className="flex items-start justify-between gap-4 border-b rule py-3">
      <span className="flex items-center gap-2.5"><span className={`h-2 w-2 shrink-0 ${dot}`} />{name}</span>
      <span className="max-w-[55%] text-right text-[12px] text-muted">{detail ?? "Checking…"}</span>
    </li>
  );
}
