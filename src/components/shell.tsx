"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useMoneyRunner } from "@/lib/money/runner";
import { useStore } from "@/lib/db/store";
import { Icon } from "./ui";

const NAV = [
  { href: "/", label: "home", icon: "home" },
  { href: "/rules", label: "money rules", icon: "rules" },
  { href: "/transfers", label: "transfers", icon: "transfer" },
  { href: "/history", label: "activity", icon: "history" },
  { href: "/settings", label: "settings", icon: "settings" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/settings") return path.startsWith("/settings") || path.startsWith("/wallet") || path.startsWith("/payment-wallet");
  return path.startsWith(href);
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`display inline-flex items-baseline text-[24px] leading-none font-medium text-accent ${className}`} aria-label="subscan home">
      sub<span className="italic">scan</span>
      <span className="ml-[3px] inline-block h-[6px] w-[6px] rounded-[1px] bg-sand" aria-hidden />
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const store = useStore();
  const { state, ready } = store;
  const [notes, setNotes] = useState<string[]>([]);
  useMoneyRunner(store, (m) => {
    setNotes((n) => [...n.slice(-2), m]);
    setTimeout(() => setNotes((n) => n.slice(1)), 8000);
  });
  const waiting = ready ? state.activity.filter((a) => a.status === "awaiting_approval").length : 0;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r rule bg-paper lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-6 pt-7 pb-6">
          <Wordmark />
          <div className="mt-1 text-[12px] text-muted">your money, handled</div>
        </div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {NAV.map((n) => {
            const on = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium transition-colors ${on ? "bg-accent text-[#fbfaf6]" : "text-ink-2 hover:bg-paper-2 hover:text-ink"}`}
              >
                <Icon name={n.icon} size={18} />
                {n.label}
                {n.href === "/history" && waiting > 0 && <span className={`ml-auto rounded-full px-1.5 text-[11px] num ${on ? "bg-white/20" : "bg-amber-wash text-amber"}`}>{waiting}</span>}
              </Link>
            );
          })}
        </nav>
        <p className="mt-auto px-6 py-5 text-[11.5px] leading-snug text-faint">Rules and transfers run while subscan is open in a browser.</p>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-paper/95 px-4 backdrop-blur lg:hidden">
        <Wordmark className="text-[22px]" />
      </header>

      <main className="min-w-0 pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-12"><div className="mx-auto max-w-[1120px]">{children}</div></main>

      {notes.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex flex-col items-center gap-1.5 px-4 lg:bottom-6 lg:left-[232px]" aria-live="polite">
          {notes.map((n, i) => <div key={i} className="anim-rise max-w-md rounded-full bg-ink px-4 py-2 text-[13px] text-[#f6f2e9] shadow-lg">{n}</div>)}
        </div>
      )}

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-[560px] grid-cols-5">
          {NAV.map((n) => {
            const on = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`relative flex flex-col items-center gap-1 pt-2 pb-2 text-[10.5px] font-medium whitespace-nowrap ${on ? "text-accent" : "text-muted"}`}>
                <span className={`inline-flex h-7 w-11 items-center justify-center rounded-full transition-colors ${on ? "bg-sage" : ""}`}><Icon name={n.icon} size={19} /></span>
                {n.label.replace("money ", "")}
                {n.href === "/history" && waiting > 0 && <span className="absolute top-1.5 right-[calc(50%-20px)] h-2 w-2 rounded-full bg-amber ring-2 ring-surface" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
