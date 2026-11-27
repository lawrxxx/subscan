"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/db/store";
import { useWallet } from "./wallet";
import { shortHash } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", n: "01", short: "Overview" },
  { href: "/subscriptions", label: "Subscriptions", n: "02", short: "Subs" },
  { href: "/agent", label: "Agent", n: "03", short: "Agent" },
  { href: "/activity", label: "Payments", n: "04", short: "Payments" },
  { href: "/wallet", label: "Wallet", n: "05", short: "Wallet" },
  { href: "/settings", label: "Settings", n: "06", short: "Settings" },
];
const MOBILE_NAV = NAV.slice(0, 5);

function active(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/subscriptions") return path.startsWith("/subscriptions") || path.startsWith("/pay");
  return path.startsWith(href);
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`display text-[26px] leading-none tracking-tight ${className}`} aria-label="subscan home">
      sub<span className="italic">scan</span>
      <span className="ml-0.5 inline-block h-[7px] w-[7px] translate-y-[-1px] bg-accent align-baseline" aria-hidden />
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { state, mode, user, syncing, error, clearError, loadError, reload, ready, signOut } = useStore();
  const w = useWallet();
  if (["/onboarding", "/login", "/signup", "/reset", "/auth"].some((p) => path.startsWith(p))) return <>{children}</>;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="hidden border-r rule lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-dvh">
        <div className="px-7 pt-8 pb-10">
          <Wordmark />
          <p className="mt-2 text-[12px] leading-snug text-muted">Subscription intelligence,<br />settled on Celo.</p>
        </div>
        <nav className="flex flex-col px-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`group flex items-baseline gap-3 border-t rule px-3 py-3 text-[14px] last:border-b ${active(path, n.href) ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              <span className={`num text-[11px] ${active(path, n.href) ? "text-accent" : "text-faint"}`}>{n.n}</span>
              <span className={active(path, n.href) ? "font-medium" : ""}>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-7 pb-7 text-[12px] text-muted">
          {state.dataSource === "sample" && <div className="tag border-amber/40 bg-amber-wash text-amber">Sample statement</div>}
          <div>
            <div className="kicker mb-1">{mode === "account" ? "Signed in" : "Guest mode"}</div>
            {mode === "account" ? (
              <div className="space-y-1">
                <div className="truncate text-ink-2" title={user?.email}>{state.settings.displayName || user?.email || "…"}</div>
                <button onClick={() => void signOut()} className="link">Sign out</button>
              </div>
            ) : (
              <div>Data stays on this device.</div>
            )}
          </div>
          <div>
            <div className="kicker mb-1">Wallet</div>
            {w.address ? (
              <div className="font-mono text-[12px] text-ink-2">
                {shortHash(w.address, 4)} <span className={w.onCelo ? "text-accent" : "text-alert"}>{w.onCelo ? "· Celo" : "· wrong network"}</span>
              </div>
            ) : (
              <Link href="/wallet" className="link">Not connected</Link>
            )}
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b rule bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        <Wordmark className="text-[22px]" />
        <div className="flex items-center gap-2">
          {state.dataSource === "sample" && <span className="tag border-amber/40 bg-amber-wash text-amber">Sample</span>}
          <Link href="/settings" aria-label="Settings" className={`text-[12px] ${path.startsWith("/settings") ? "text-ink" : "text-muted"}`}>Settings</Link>
        </div>
      </header>

      <main className="min-w-0 pb-24 lg:pb-0">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-4 border-b border-alert/30 bg-alert-wash px-4 py-2 text-[13px] text-alert sm:px-8 lg:px-12">
            <span>Couldn&rsquo;t save that change: {error}</span>
            <button onClick={clearError} className="underline underline-offset-2">Dismiss</button>
          </div>
        )}
        {syncing && <div className="fixed right-4 top-3 z-30 hidden items-center gap-2 border rule bg-paper px-2.5 py-1 text-[11px] text-muted lg:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />Saving</div>}
        {state.dataSource === "sample" && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-amber/30 bg-amber-wash/70 px-4 py-2 text-[12px] text-amber sm:px-8 lg:px-12">
            <span><strong className="font-semibold">Sample data.</strong> These subscriptions come from a made-up statement, not your accounts.</span>
            <Link href="/onboarding" className="underline underline-offset-2">Import your own statement →</Link>
          </div>
        )}
        {loadError ? (
          <div className="px-4 py-20 sm:px-8 lg:px-12">
            <div className="kicker mb-3 text-alert">Connection problem</div>
            <h1 className="display text-[40px]">We couldn&rsquo;t load your account.</h1>
            <p className="mt-3 max-w-md text-[14px] text-muted">{loadError}</p>
            <button className="btn btn-primary mt-6" onClick={() => void reload()}>Try again</button>
          </div>
        ) : !ready ? (
          <PageSkeleton />
        ) : (
          children
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE_NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${active(path, n.href) ? "text-ink" : "text-muted"}`}>
            <span className={`num text-[10px] ${active(path, n.href) ? "text-accent" : "text-faint"}`}>{n.n}</span>
            {n.short}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ kicker, title, children, aside }: { kicker?: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="border-b rule px-4 pt-8 pb-6 sm:px-8 lg:px-12 lg:pt-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          {kicker && <div className="kicker mb-3">{kicker}</div>}
          <h1 className="display text-[38px] sm:text-[52px]">{title}</h1>
          {children && <div className="mt-3 max-w-xl text-[15px] text-muted">{children}</div>}
        </div>
        {aside}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse px-4 py-10 sm:px-8 lg:px-12" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-32 bg-stone" />
      <div className="mt-5 h-12 w-2/3 max-w-xl bg-stone" />
      <div className="mt-10 grid gap-px sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-paper-2" />)}
      </div>
      <div className="mt-10 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-paper-2" />)}
      </div>
    </div>
  );
}
