"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { txUrl } from "@/lib/celo/config";
import { shortHash } from "@/lib/format";
import type { PaymentStatus, SubscriptionStatus } from "@/lib/types";

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const filled = Math.round(value * 5);
  return (
    <span className="inline-flex items-center gap-2" title={`Detection confidence ${pct}%`}>
      <span className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`h-[9px] w-[4px] ${i < filled ? (value >= 0.75 ? "bg-accent" : value >= 0.55 ? "bg-ink-2" : "bg-amber") : "bg-stone"}`} />
        ))}
      </span>
      <span className="num text-[12px] text-muted">{pct}%</span>
    </span>
  );
}

export function StatusTag({ status }: { status: SubscriptionStatus }) {
  if (status === "confirmed") return <span className="tag border-accent/40 bg-accent-wash text-accent">Confirmed</span>;
  if (status === "dismissed") return <span className="tag text-muted">Dismissed</span>;
  return <span className="tag border-amber/40 bg-amber-wash text-amber">Detected</span>;
}

const TX: Record<PaymentStatus, { label: string; cls: string }> = {
  prepared: { label: "Prepared", cls: "text-muted" },
  pending: { label: "Pending", cls: "border-amber/40 bg-amber-wash text-amber" },
  confirmed: { label: "Confirmed", cls: "border-accent/40 bg-accent-wash text-accent" },
  failed: { label: "Failed", cls: "border-alert/40 bg-alert-wash text-alert" },
};

export function TxStatus({ status }: { status: PaymentStatus }) {
  const t = TX[status];
  return (
    <span className={`tag ${t.cls}`}>
      {status === "pending" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />}
      {t.label}
    </span>
  );
}

export function HashLink({ hash, n = 6 }: { hash: string; n?: number }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">
      {shortHash(hash, n)} ↗
    </a>
  );
}

/** Minimal, safe markdown for agent replies: paragraphs, bullet lists, **bold**, [links](/internal or https). */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose-agent">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim());
        if (isList)
          return (
            <ul key={i}>
              {lines.filter((l) => l.trim()).map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}
            </ul>
          );
        // mixed: paragraph lines then list lines
        const out: ReactNode[] = [];
        let buf: string[] = [];
        let list: string[] = [];
        const flush = () => {
          if (buf.length) out.push(<p key={`p${out.length}`}>{buf.map((l, k) => <span key={k}>{inline(l)}{k < buf.length - 1 && <br />}</span>)}</p>);
          if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((l, k) => <li key={k}>{inline(l)}</li>)}</ul>);
          buf = [];
          list = [];
        };
        for (const l of lines) {
          if (/^\s*[-*•]\s+/.test(l)) {
            if (buf.length) flush();
            list.push(l.replace(/^\s*[-*•]\s+/, ""));
          } else {
            if (list.length) flush();
            if (l.trim()) buf.push(l.replace(/^#+\s*/, ""));
          }
        }
        flush();
        return <div key={i}>{out}</div>;
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={m.index} className="font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    else {
      const [, label, href] = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      if (href.startsWith("/")) parts.push(<Link key={m.index} href={href}>{label}</Link>);
      else if (/^https:\/\//.test(href)) parts.push(<a key={m.index} href={href} target="_blank" rel="noreferrer">{label}</a>);
      else parts.push(label);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
