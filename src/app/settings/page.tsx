"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ATTRIBUTION_CODES } from "@/lib/celo/attribution";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { PageBar } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { shortHash } from "@/lib/format";

interface Status {
  celoRpc: { ok: boolean; block?: string; error?: string };
  textile: { ok: boolean; ngnPerUsd?: number; auth?: string; error?: string };
  agent: { llm: boolean; model: string };
  attribution?: { app: string; assigned: boolean };
}

export default function Settings() {
  const { state, updateSettings, reset, removeImport } = useStore();
  const w = useWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [tech, setTech] = useState(false);
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
      <PageBar title="Settings" sub="Your statements, currency, wallet and data" />
      {saved && <p className="mx-4 mb-3 rounded-[6px] bg-accent-wash px-3 py-2 text-[13px] text-accent sm:mx-6 lg:mx-8" role="status">{saved}</p>}

      <Section title="Your statements" note="We keep the transactions you saved, never the files.">
        {state.imports?.length ? (
          <ul className="divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
            {state.imports.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.fileName}</span>
                  <span className="text-[12.5px] text-muted">{i.from && i.to ? `${date(i.from)} – ${date(i.to)} · ` : ""}{i.rows} transactions</span>
                </span>
                {removing === i.id ? (
                  <span className="flex shrink-0 gap-1.5">
                    <button className="btn btn-danger btn-sm" onClick={() => { removeImport(i.id); setRemoving(null); flash(`Removed ${i.fileName}`); }}>Remove</button>
                    <button className="btn btn-quiet btn-sm" onClick={() => setRemoving(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="btn btn-quiet btn-sm shrink-0" onClick={() => setRemoving(i.id)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">No statements added yet.</p>
        )}
        <Link href="/onboarding" className="btn btn-ghost mt-3">Add a statement</Link>
      </Section>

      <Section title="Currency" note="Totals are shown in this currency.">
        <div className="seg">
          {[["NGN", "Naira (₦)"], ["USD", "US dollar ($)"]].map(([c, l]) => (
            <button key={c} onClick={() => { updateSettings({ homeCurrency: c }); flash("Currency updated"); }} aria-pressed={state.settings.homeCurrency === c}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Wallet" note="Only needed if you want to pay a bill from a digital wallet. subscan never holds your money.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13.5px]">
            <div className="flex items-center gap-2 font-medium">
              <span className={`h-2 w-2 rounded-full ${w.address ? (w.onCelo ? "bg-accent" : "bg-alert") : "bg-line-strong"}`} />
              {w.address ? <span className="font-mono">{shortHash(w.address, 4)}</span> : "Not connected"}
            </div>
            {w.address && !w.onCelo && <div className="text-[12.5px] text-alert">Switch your wallet to the Celo network</div>}
          </div>
          <Link href="/wallet" className="btn btn-ghost">Open wallet</Link>
        </div>
        <label className="mt-4 flex items-center gap-3 text-[13.5px]">
          <button role="switch" aria-checked={state.settings.payGasInUsdt} onClick={() => { updateSettings({ payGasInUsdt: !state.settings.payGasInUsdt }); flash("Saved"); }} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${state.settings.payGasInUsdt ? "border-accent bg-accent" : "rule bg-paper-2"}`}>
            <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-surface transition-all ${state.settings.payGasInUsdt ? "left-[22px]" : "left-[3px]"}`} />
          </button>
          <span>Pay the small network fee in digital dollars (USD₮) instead of CELO</span>
        </label>
      </Section>

      <Section title="Delete your data" note="Everything is stored in this browser only.">
        {!confirmReset ? (
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Delete all my data</button>
        ) : (
          <div className="rounded-[6px] border border-alert/30 bg-alert-wash px-3 py-3">
            <p className="text-[13.5px]">This removes your statements, transactions and payments list from this device. Records of wallet payments you&rsquo;ve already made are kept.</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex">
              <button className="btn btn-danger" onClick={() => { reset(); setConfirmReset(false); flash("Your data was deleted"); }}>Yes, delete it</button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Section>

      <section className="mx-4 mb-6 sm:mx-6 lg:mx-8">
        <button className="text-[13px] text-muted hover:text-ink" onClick={() => setTech((v) => !v)} aria-expanded={tech}>{tech ? "Hide" : "Show"} technical details</button>
        {tech && (
          <ul className="panel mt-2 px-4 text-[13.5px]">
            <Integration name="Celo mainnet (chain 42220)" ok={status?.celoRpc.ok} detail={status ? (status.celoRpc.ok ? `Connected · block ${status.celoRpc.block}` : "Unreachable") : undefined} />
            <Integration name="Textile FX · USD₮ ↔ cNGN" ok={status?.textile.ok} detail={status ? (status.textile.ok ? `Live · 1 USD₮ ≈ ₦${status.textile.ngnPerUsd?.toFixed(2)}` : "Unreachable") : undefined} />
            <Integration name="Ask subscan (Google Gemini)" ok={status?.agent.llm} detail={status ? (status.agent.llm ? `${status.agent.model}` : "Not configured") : undefined} />
            <Integration name="Storage" ok detail="This browser only, no server database" />
            <Integration name="Transaction attribution (ERC-8021)" ok={status ? true : undefined} detail={status ? ATTRIBUTION_CODES.join(", ") : undefined} />
          </ul>
        )}
      </section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mb-3 grid gap-3 panel px-4 py-4 sm:mx-6 sm:px-5 lg:mx-8 lg:grid-cols-[220px_1fr] lg:gap-6">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">{note}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Integration({ name, ok, detail, warn }: { name: string; ok?: boolean; detail?: string; warn?: boolean }) {
  const dot = ok === undefined ? "bg-paper-2" : ok ? "bg-accent" : warn ? "bg-amber" : "bg-alert";
  return (
    <li className="flex items-start justify-between gap-4 border-b rule-soft py-2.5 last:border-b-0">
      <span className="flex items-center gap-2.5"><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{name}</span>
      <span className="max-w-[55%] text-right text-[12px] text-muted">{detail ?? "Checking…"}</span>
    </li>
  );
}
