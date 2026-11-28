"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ATTRIBUTION_CODES } from "@/lib/celo/attribution";
import { useStore } from "@/lib/db/store";
import { shortHash } from "@/lib/format";
import { accessState } from "@/lib/money/runner";
import { Icon, PageBar } from "@/components/ui";
import { useWallet } from "@/components/wallet";

interface Status {
  celoRpc: { ok: boolean; block?: string; error?: string };
  textile: { ok: boolean; ngnPerUsd?: number; auth?: string; error?: string };
  agent?: { engine: string; wallet: string; autopilot: boolean };
}

export default function Settings() {
  const { state, updateSettings, reset } = useStore();
  const w = useWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tech, setTech] = useState(false);
  const [saved, setSaved] = useState<string>();
  const access = accessState(state);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j) => setStatus(j.data)).catch(() => setStatus(null));
  }, []);
  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(undefined), 1800);
  };
  const accessText = { none: "Not set up", revoked: "Access revoked", expired: "Access expired", off: "Automation paused", on: "Automation on" }[access];

  return (
    <div className="lg:max-w-[880px]">
      <PageBar title="settings" sub="payment wallet, everyday wallet and your data" />
      {saved && <p className="callout callout-sage mx-4 mb-3 block text-[13px] sm:mx-6 lg:mx-8" role="status">{saved}</p>}

      <Section title="Payment wallet" note="Where your rules and transfers run. Limits, per-transfer cap, access and revoke.">
        <Link href="/payment-wallet" className="row -mx-1 rounded-[12px] px-1">
          <span className="flex min-w-0 items-center gap-3"><span className="tile"><Icon name="wallet" size={17} /></span><span className="min-w-0"><span className="row-title">{state.autopilot?.wallet ? shortHash(state.autopilot.wallet, 4) : "Set up your payment wallet"}</span><span className="row-sub">{state.autopilot?.wallet ? accessText : "Face ID or fingerprint, no passwords"}</span></span></span>
          <Icon name="chev" size={16} className="chev" />
        </Link>
      </Section>

      <Section title="Saved recipients" note="The only addresses subscan can send to.">
        <Link href="/transfers" className="row -mx-1 rounded-[12px] px-1">
          <span className="flex min-w-0 items-center gap-3"><span className="tile"><Icon name="user" size={17} /></span><span className="min-w-0"><span className="row-title">{state.recipients.length} saved</span><span className="row-sub">Add or remove in Transfers</span></span></span>
          <Icon name="chev" size={16} className="chev" />
        </Link>
      </Section>

      <Section title="Everyday wallet" note="MiniPay or MetaMask, for adding money and registering subscan's identity.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13.5px]">
            <div className="flex items-center gap-2 font-medium">
              <span className={`h-2 w-2 rounded-full ${w.address ? (w.onCelo ? "bg-positive" : "bg-alert") : "bg-line-strong"}`} />
              {w.address ? <span className="font-mono">{shortHash(w.address, 4)}</span> : "Not connected"}
            </div>
            {w.address && !w.onCelo && <div className="text-[12.5px] text-alert">Switch your wallet to the Celo network</div>}
          </div>
          <Link href="/wallet" className="btn btn-ghost">Open</Link>
        </div>
        <label className="mt-4 flex items-center gap-3 text-[13.5px]">
          <button role="switch" aria-checked={state.settings.payGasInUsdt} onClick={() => { updateSettings({ payGasInUsdt: !state.settings.payGasInUsdt }); flash("Saved"); }} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${state.settings.payGasInUsdt ? "bg-accent" : "bg-line-strong"}`}>
            <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface transition-all ${state.settings.payGasInUsdt ? "left-[23px]" : "left-[3px]"}`} />
          </button>
          <span>Pay network fees from your everyday wallet in US dollars (USD₮) instead of CELO</span>
        </label>
      </Section>

      <Section title="Delete your data" note="Everything is stored in this browser only.">
        {!confirmReset ? (
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Delete my rules and schedules</button>
        ) : (
          <div className="rounded-[12px] bg-alert-wash px-3 py-3">
            <p className="text-[13.5px]">This removes your money rules, schedules and saved recipients from this browser. Your payment wallet, its money and the record of completed transactions stay.</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex">
              <button className="btn btn-danger" onClick={() => { reset(); setConfirmReset(false); flash("Deleted"); }}>Yes, delete</button>
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
            <Integration name="Textile FX · USD₮ ↔ cNGN" ok={status?.textile.ok} detail={status ? (status.textile.ok ? `Live · 1 USD₮ ≈ ${status.textile.ngnPerUsd?.toFixed(2)} cNGN` : "Unreachable") : undefined} />
            <Integration name="Decisions" ok detail="Deterministic rules inside subscan. No AI model." />
            <Integration name="Altana smart wallet + session" ok={status?.agent?.autopilot} detail={status ? (status.agent?.autopilot ? "Ready" : "AUTOPILOT_SEAL_KEY not set") : undefined} />
            <Integration name="Scheduling" ok detail="Runs while subscan is open in a browser. No background server." />
            <Integration name="Storage" ok detail="This browser only, no server database" />
            <Integration name="Transaction attribution (ERC-8021)" ok={status ? true : undefined} detail={status ? `${ATTRIBUTION_CODES.join(", ")} · Altana: altana,subscan,celo_e97672462153` : undefined} />
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

function Integration({ name, ok, detail }: { name: string; ok?: boolean; detail?: string }) {
  const dot = ok === undefined ? "bg-paper-2" : ok ? "bg-positive" : "bg-alert";
  return (
    <li className="flex items-start justify-between gap-4 border-b rule-soft py-2.5 last:border-b-0">
      <span className="flex items-center gap-2.5"><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{name}</span>
      <span className="max-w-[55%] text-right text-[12px] text-muted">{detail ?? "Checking…"}</span>
    </li>
  );
}
