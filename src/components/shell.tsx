"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/db/store";
import { Icon } from "./ui";
import { useWallet } from "./wallet";

const NAV = [
  { href: "/", label: "home", icon: "home" },
  { href: "/payments", label: "payments", icon: "bills" },
  { href: "/spending", label: "spending", icon: "spending" },
  { href: "/agent", label: "subscan", icon: "agent" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/payments") return path.startsWith("/payments") || path.startsWith("/pay");
  if (href === "/settings") return path.startsWith("/settings") || path.startsWith("/wallet") || path.startsWith("/autopilot");
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
  const { state, ready } = useStore();
  const w = useWallet();
  if (path.startsWith("/onboarding") || path.startsWith("/review")) return <>{children}</>;
  const review = state.subscriptions.filter((s) => s.status === "detected").length;

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
                {n.href === "/payments" && ready && review > 0 && <span className={`ml-auto rounded-full px-1.5 text-[11px] num ${on ? "bg-white/20" : "bg-amber-wash text-amber"}`}>{review}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 px-3">
          <Link href="/onboarding" className="btn btn-ghost w-full">
            <Icon name="upload" size={16} /> add a statement
          </Link>
        </div>
        <div className="mt-auto px-3 py-4">
          <Link href="/settings" className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium ${isActive(path, "/settings") ? "bg-paper-2 text-ink" : "text-muted hover:bg-paper-2 hover:text-ink"}`}>
            <Icon name="settings" size={18} /> <span className="flex-1">settings</span>
            {w.address && <span className={`h-1.5 w-1.5 rounded-full ${w.onCelo ? "bg-positive" : "bg-alert"}`} title="Wallet connected" />}
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-paper/95 px-4 backdrop-blur lg:hidden">
        <Wordmark className="text-[22px]" />
        <div className="flex items-center gap-1">
          <Link href="/onboarding" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2" aria-label="Add a statement"><Icon name="upload" size={20} /></Link>
          <Link href="/settings" className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-paper-2 ${isActive(path, "/settings") ? "bg-paper-2 text-ink" : "text-ink-2"}`} aria-label="Settings">
            <Icon name="settings" size={20} />
            {w.address && <span className={`absolute top-2 right-2 h-1.5 w-1.5 rounded-full ${w.onCelo ? "bg-positive" : "bg-alert"}`} />}
          </Link>
        </div>
      </header>

      <main className="min-w-0 pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-12"><div className="mx-auto max-w-[1120px]">{children}</div></main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-[520px] grid-cols-4">
          {NAV.map((n) => {
            const on = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`relative flex flex-col items-center gap-1 pt-2 pb-2 text-[11px] font-medium ${on ? "text-accent" : "text-muted"}`}>
                <span className={`inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors ${on ? "bg-sage" : ""}`}><Icon name={n.icon} size={19} /></span>
                {n.label}
                {n.href === "/payments" && ready && review > 0 && <span className="absolute top-1.5 right-[calc(50%-22px)] h-2 w-2 rounded-full bg-amber ring-2 ring-surface" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
