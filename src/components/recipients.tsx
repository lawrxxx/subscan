"use client";
import { useState } from "react";
import type { Recipient } from "@/lib/types";
import { addressUrl } from "@/lib/celo/config";
import { Avatar, Icon } from "./ui";
import { addressProblem, DESTINATIONS, NETWORK, TOKEN_NAME, WARNING, destinationOf, tokensFor, type Destination } from "@/lib/money/destinations";

/** 0x1234 5678 … grouped so it's easy to compare character by character. */
export function AddressBlock({ address }: { address: string }) {
  const body = address.slice(2).match(/.{1,4}/g) ?? [];
  return (
    <div className="rounded-[12px] bg-paper-2 px-3 py-2.5 font-mono text-[14px] leading-relaxed tracking-wide break-all text-ink">
      <span className="text-muted">0x</span>
      {body.map((g, i) => <span key={i} className={i % 2 ? "text-ink-2" : ""}>{g}{i < body.length - 1 ? " " : ""}</span>)}
    </div>
  );
}

/**
 * Add a recipient: where they receive money → name and address (with that
 * destination's instructions) → confirm every detail. The address is stored
 * exactly as pasted.
 */
export function AddRecipient({ existing, onDone, onCancel }: { existing: Recipient[]; onDone(r: Recipient): void; onCancel(): void }) {
  const [step, setStep] = useState<"where" | "details" | "confirm">("where");
  const [dest, setDest] = useState<Destination | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string>();
  const tokens = dest?.tokens ?? [];

  if (step === "where" || !dest) {
    return (
      <div className="space-y-3">
        <div className="px-1 text-[13.5px] text-ink-2">Where will they receive the money?</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {DESTINATIONS.map((d) => {
            const off = !d.tokens.length;
            return (
              <button key={d.id} type="button" disabled={off} onClick={() => { setDest(d); setStep("details"); setErr(undefined); }} aria-label={`${d.name}${off ? " (not available on Celo)" : ""}`} className={`flex items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left ${off ? "cursor-not-allowed rule bg-paper-2/60" : "rule bg-surface hover:border-accent"}`}>
                <Avatar name={d.name.replace("Another ", "")} size={36} />
                <span className="min-w-0">
                  <span className={`block text-[14px] font-semibold ${off ? "text-muted" : ""}`}>{d.name}</span>
                  <span className="block text-[12.5px] text-muted">{off ? "Not available on Celo yet" : `${d.tokens.map((t) => (t === "USDT" ? "USD₮" : "cNGN")).join(" or ")} on ${NETWORK}`}</span>
                </span>
              </button>
            );
          })}
        </div>
        {DESTINATIONS.filter((d) => !d.tokens.length).map((d) => <p key={d.id} className="px-1 text-[12px] text-muted"><span className="font-medium text-ink-2">{d.name}:</span> {d.unavailable}</p>)}
        <div className="flex justify-end"><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="panel space-y-3 px-4 py-4">
        <div className="text-[15px] font-semibold">Check these details</div>
        <dl className="rows rounded-[12px] border rule text-[13.5px]">
          <Detail k="Recipient">{name.trim()}</Detail>
          <Detail k="Receives on">{dest.name}</Detail>
          <Detail k={tokens.length > 1 ? "Tokens" : "Token"}>{tokens.map((t) => TOKEN_NAME[t]).join(", ")}</Detail>
          <Detail k="Network">{NETWORK}</Detail>
        </dl>
        <div>
          <div className="mb-1.5 text-[12.5px] text-muted">Wallet address, exactly as you pasted it</div>
          <AddressBlock address={address} />
          <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[12.5px] text-muted underline underline-offset-2">See this address on Celoscan</a>
        </div>
        <p className="callout callout-amber block text-[12.5px]">{WARNING}</p>
        <p className="text-[12.5px] text-muted">subscan can check that this is a valid Celo address, but not who it belongs to. Compare it with the one {dest.kind === "exchange" ? `in ${dest.name}` : "in the receiving wallet"} character by character.</p>
        <label className="flex items-start gap-2.5 text-[13.5px]">
          <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I&rsquo;ve checked the address, token and network. Money sent to a wrong address can&rsquo;t be recovered.</span>
        </label>
        <p className="text-[12px] text-muted">Once saved, the address can&rsquo;t be edited. To change it, add a new recipient.</p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button className="btn btn-ghost" onClick={() => { setStep("details"); setChecked(false); }}>Back</button>
          <button className="btn btn-primary" disabled={!checked} onClick={() => { const t = new Date().toISOString(); onDone({ id: `rcp_${Date.now().toString(36)}`, name: name.trim(), address: address as `0x${string}`, createdAt: t, confirmedAt: t, destination: dest.id, tokens: [...tokens] }); }}>Save recipient</button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="panel space-y-3 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setErr("Add a name you'll recognise.");
        const problem = addressProblem(address, existing);
        if (problem) return setErr(problem);
        setErr(undefined);
        setStep("confirm");
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Avatar name={dest.name.replace("Another ", "")} size={36} /><div><div className="text-[15px] font-semibold">{dest.name}</div><div className="text-[12.5px] text-muted">{tokens.map((t) => (t === "USDT" ? "USD₮" : "cNGN")).join(" or ")} on {NETWORK}</div></div></div>
        <button type="button" className="text-[12.5px] text-muted underline underline-offset-2" onClick={() => setStep("where")}>Change</button>
      </div>
      <label className="block text-[12.5px] text-muted">Recipient name<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum" maxLength={60} /></label>
      <div className="rounded-[12px] bg-paper-2 px-3 py-3">
        <div className="text-[13px] font-medium">How to find the address</div>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-2">{dest.steps.map((x) => <li key={x}>{x}</li>)}</ol>
        {dest.note && <p className="mt-2 text-[12px] text-muted">{dest.note}</p>}
      </div>
      <label className="block text-[12.5px] text-muted">{dest.kind === "exchange" ? `${dest.name} deposit address (${tokens.map((t) => (t === "USDT" ? "USDT" : "cNGN")).join("/")}, Celo network)` : "Wallet address on Celo"}
        <input className="input mt-1 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </label>
      <p className="text-[12px] text-amber">{WARNING}</p>
      {err && <p className="text-[13px] text-alert" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary">Continue</button>
      </div>
    </form>
  );
}

function Detail({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 px-3 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{children}</dd></div>;
}

export function RecipientRow({ r, children }: { r: Recipient; children?: React.ReactNode }) {
  return (
    <div className="row">
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={r.name} size={36} />
        <span className="min-w-0"><span className="row-title">{r.name}</span><span className="row-sub">{destinationOf(r).name} · {tokensFor(r).map((t) => (t === "USDT" ? "USD₮" : "cNGN")).join(", ")} · <span className="font-mono">{r.address.slice(0, 6)}…{r.address.slice(-4)}</span>{r.confirmedAt ? "" : " · not confirmed"}</span></span>
      </span>
      <span className="flex shrink-0 items-center gap-1">{children ?? <Icon name="check" size={16} className="text-positive" />}</span>
    </div>
  );
}
