"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/db/store";
import { Icon } from "./ui";
import { useWallet } from "./wallet";

const NAV = [
  { href: "/", label: "Home", short: "Home", icon: "home" },
  { href: "/payments", label: "Payments", short: "Payments", icon: "bills" },
  { href: "/spending", label: "Spending", short: "Spending", icon: "spending" },
  { href: "/ask", label: "Ask subscan", short: "Ask", icon: "chat" },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/payments") return path.startsWith("/payments") || path.startsWith("/pay");
  if (href === "/settings") return path.startsWith("/settings") || path.startsWith("/wallet") || path.startsWith("/autopilot");
  return path.startsWith(href);
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`display inline-flex items-baseline text-[22px] leading-none ${className}`} aria-label="subscan home">
      sub<span className="italic">scan</span>
      <span className="ml-[3px] inline-block h-[6px] w-[6px] bg-accent" aria-hidden />
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[228px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r rule bg-paper lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-5 pt-6 pb-5">
          <Wordmark />
        </div>
        <div className="px-3">
          <Link href="/onboarding" className="btn btn-primary w-full">
            Add a statement
          </Link>
        </div>
        <nav className="mt-5 flex flex-col gap-0.5 px-3" aria-label="Main">
          {NAV.map((n) => {
            const on = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 rounded-[5px] px-2.5 py-2 text-[13.5px] font-medium transition-colors ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-rule)]" : "text-muted hover:bg-paper-2 hover:text-ink"}`}
              >
                <Icon name={n.icon} size={17} className={on ? "text-accent" : ""} />
                {n.label}
                {n.href === "/payments" && ready && review > 0 && <span className="ml-auto rounded-full bg-amber-wash px-1.5 text-[11px] text-amber num">{review}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t rule px-3 py-3">
          <Link href="/settings" className={`flex items-center gap-3 rounded-[5px] px-2.5 py-2 text-[13.5px] font-medium ${path.startsWith("/settings") || path.startsWith("/wallet") ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-rule)]" : "text-muted hover:bg-paper-2 hover:text-ink"}`}>
            <Icon name="settings" size={17} /> <span className="flex-1">Settings</span>
            {w.address && <span className={`h-1.5 w-1.5 rounded-full ${w.onCelo ? "bg-accent" : "bg-alert"}`} title="Wallet connected" />}
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b rule bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        <Wordmark className="text-[20px]" />
        <div className="flex items-center gap-1">
          <Link href="/onboarding" className="btn btn-primary btn-sm" aria-label="Add a statement">Add statement</Link>
          <Link href="/settings" className="btn btn-quiet btn-sm" aria-label="Settings"><Icon name="settings" size={18} /></Link>
        </div>
      </header>

      <main className="min-w-0 pb-24 lg:pb-10"><div className="mx-auto max-w-[1200px]">{children}</div></main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t rule bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        {NAV.map((n) => {
          const on = isActive(path, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 pt-2 pb-2 text-[10.5px] font-medium ${on ? "text-accent" : "text-muted"}`}>
              <Icon name={n.icon} size={20} />
              {n.short}
              {n.href === "/payments" && ready && review > 0 && <span className="absolute top-1 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-amber" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
