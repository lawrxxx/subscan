"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PaymentStatus, Subscription } from "@/lib/types";
import { level, LEVEL_LABEL } from "@/lib/review";

/* Icons: 1.5px line icons drawn for subscan (24px grid). */
const PATHS: Record<string, string> = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z",
  spending: "M5 20V10m5 10V4m5 16v-7m5 7V8",
  chat: "M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-4.5 3.5V17H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 6h.01M12 11h.01M15 11h.01",
  overview: "M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z",
  bills: "M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Zm2 5h6M9 11h6M9 14h4",
  activity: "M4 6h16M4 12h16M4 18h10",
  agent: "M11 3.5 12.9 9l5.6 1.9-5.6 1.9L11 18.4l-1.9-5.6L3.5 11l5.6-1.9L11 3.5Zm7.5 11 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z",
  wallet: "M4 7a2 2 0 0 1 2-2h11v4M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7a2 2 0 0 0 2 2h13a1 1 0 0 1 1 1v3m0 0h-4a1.5 1.5 0 0 0 0 3h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h5l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  search: "m20 20-4.2-4.2M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  check: "m5 12 4.5 4.5L19 7",
  alert: "M12 8v5m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  doc: "M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Zm0 0v4h4M9 13h6M9 16h4",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",
  spark: "M12 4v4m0 8v4M4 12h4m8 0h4",
};

export function Icon({ name, size = 18, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? PATHS.spark} />
    </svg>
  );
}

/** Page header: serif title, short description, actions on the right. */
export function PageBar({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-4 pt-5 pb-4 sm:px-6 lg:px-8 lg:pt-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="title text-[22px] sm:text-[24px]">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "alert" | "accent" }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <div className="label">{label}</div>
      <div className={`figure mt-1.5 truncate text-[24px] sm:text-[26px] ${tone === "alert" ? "text-alert" : tone === "accent" ? "text-accent" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

const AVATAR_TONES = ["#e7e1d3", "#dfe6dc", "#e6dfe2", "#dde3ea", "#ebe3d2", "#e0e4df"];

/** Merchant monogram — no third-party logos. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const clean = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const letters = (clean.split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "•").toUpperCase();
  const tone = AVATAR_TONES[[...clean].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[6px] text-[11px] font-semibold text-ink-2" style={{ width: size, height: size, background: tone }} aria-hidden>
      {letters}
    </span>
  );
}

export function BillStatus({ s }: { s: Subscription }) {
  if (s.status === "dismissed") return <span className="pill">Dismissed</span>;
  if (s.missed) return <span className="pill pill-red">Missed?</span>;
  if (s.lapsed) return <span className="pill">Stopped</span>;
  if (s.status === "detected") return <span className="pill pill-amber">Needs review</span>;
  return <span className="pill pill-green">Active</span>;
}

const PAY: Record<PaymentStatus, [string, string]> = {
  prepared: ["Draft", ""],
  pending: ["Processing", "pill-blue"],
  confirmed: ["Paid", "pill-green"],
  failed: ["Failed", "pill-red"],
};
export function PayStatus({ status }: { status: PaymentStatus }) {
  const [label, cls] = PAY[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}

/** Plain-language recurrence label, based on the evidence rather than a raw score. */
export function RecurrenceText({ s }: { s: Subscription }) {
  const lv = level(s);
  return <span className={`text-[12px] ${lv === "likely" ? "text-accent" : lv === "possible" ? "text-ink-2" : "text-amber"}`}>{s.manual ? "Added by you" : LEVEL_LABEL[lv]}</span>;
}

export function EmptyPanel({ icon = "doc", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-paper-2 text-muted"><Icon name={icon} /></span>
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-sm text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function UploadButton({ label = "Add a statement", className = "btn btn-primary" }: { label?: string; className?: string }) {
  return (
    <Link href="/onboarding" className={className}>
      {label}
    </Link>
  );
}
