"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { txUrl } from "@/lib/celo/config";
import { shortHash } from "@/lib/format";
import { PayStatus } from "./ui";
import type { PaymentStatus, SubscriptionStatus } from "@/lib/types";

export function StatusTag({ status }: { status: SubscriptionStatus }) {
  if (status === "confirmed") return <span className="pill pill-green">Active</span>;
  if (status === "dismissed") return <span className="pill">Dismissed</span>;
  return <span className="pill pill-amber">Needs review</span>;
}

export function TxStatus({ status }: { status: PaymentStatus }) {
  return <PayStatus status={status} />;
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
