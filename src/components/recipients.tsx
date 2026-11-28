"use client";
import { useState } from "react";
import { isAddress, getAddress } from "viem";
import type { Recipient } from "@/lib/types";
import { addressUrl } from "@/lib/celo/config";
import { Avatar, Icon } from "./ui";

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

/** Add a recipient in two steps: details, then confirm the exact address. */
export function AddRecipient({ existing, onDone, onCancel }: { existing: Recipient[]; onDone(r: Recipient): void; onCancel(): void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string>();
  const clean = address.trim();

  if (step === "confirm") {
    const a = getAddress(clean);
    return (
      <div className="panel space-y-3 px-4 py-4">
        <div className="flex items-center gap-3"><Avatar name={name} size={40} /><div><div className="text-[15px] font-semibold">{name}</div><div className="text-[12.5px] text-muted">Check this address with {name} before you save it.</div></div></div>
        <AddressBlock address={a} />
        <a href={addressUrl(a)} target="_blank" rel="noreferrer" className="inline-block text-[12.5px] text-muted underline underline-offset-2">See this address on Celoscan</a>
        <label className="flex items-start gap-2.5 text-[13.5px]">
          <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I&rsquo;ve checked every character. Money sent to a wrong address can&rsquo;t be recovered.</span>
        </label>
        <p className="text-[12.5px] text-muted">Once saved, this address can&rsquo;t be edited. To change it, add a new recipient.</p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button className="btn btn-ghost" onClick={() => setStep("details")}>Back</button>
          <button className="btn btn-primary" disabled={!checked} onClick={() => { const t = new Date().toISOString(); onDone({ id: `rcp_${Date.now().toString(36)}`, name: name.trim(), address: a, createdAt: t, confirmedAt: t }); }}>Save recipient</button>
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
        if (!isAddress(clean, { strict: false })) return setErr("That isn't a valid wallet address. It starts with 0x and has 40 more letters and numbers.");
        if (/^0x0{40}$/i.test(clean)) return setErr("That address can't receive money.");
        if (existing.some((r) => r.address.toLowerCase() === clean.toLowerCase())) return setErr("You've already saved this address.");
        setErr(undefined);
        setStep("confirm");
      }}
    >
      <div className="text-[15px] font-semibold">New recipient</div>
      <label className="block text-[12.5px] text-muted">Name<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum" maxLength={60} /></label>
      <label className="block text-[12.5px] text-muted">Their wallet address on Celo<input className="input mt-1 font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} /></label>
      <p className="text-[12px] text-muted">MiniPay and most Celo wallets show this under &ldquo;Receive&rdquo;. It must accept USD₮ and cNGN on Celo.</p>
      {err && <p className="text-[13px] text-alert" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary">Continue</button>
      </div>
    </form>
  );
}

export function RecipientRow({ r, children }: { r: Recipient; children?: React.ReactNode }) {
  return (
    <div className="row">
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={r.name} size={36} />
        <span className="min-w-0"><span className="row-title">{r.name}</span><span className="row-sub font-mono">{r.address.slice(0, 6)}…{r.address.slice(-4)}{r.confirmedAt ? "" : " · not confirmed"}</span></span>
      </span>
      <span className="flex shrink-0 items-center gap-1">{children ?? <Icon name="check" size={16} className="text-positive" />}</span>
    </div>
  );
}
