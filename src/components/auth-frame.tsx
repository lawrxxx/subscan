import type { ReactNode } from "react";
import { Wordmark } from "./shell";

export function AuthFrame({ kicker, title, children, aside }: { kicker: string; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <section className="flex flex-col border-b rule px-4 py-6 sm:px-8 lg:border-b-0 lg:border-r lg:px-12">
        <Wordmark />
        <div className="my-auto w-full max-w-md py-12">
          <div className="kicker mb-4">{kicker}</div>
          <h1 className="display text-[40px] sm:text-[52px]">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
        <p className="text-[12px] text-faint">Celo mainnet · Textile FX · your keys stay in your wallet.</p>
      </section>
      <aside className="hidden bg-paper-2/60 px-12 py-16 lg:flex lg:flex-col lg:justify-center">
        {aside ?? (
          <div className="max-w-md">
            <div className="kicker mb-3">subscan</div>
            <p className="display text-[34px] leading-tight">Every recurring charge in your statement, its true yearly cost, and the day it renews next.</p>
            <ul className="mt-10 space-y-4 border-t rule pt-6 text-[14px] text-ink-2">
              <li className="grid grid-cols-[28px_1fr]"><span className="num text-faint">01</span>Import a statement or link a bank through Mono.</li>
              <li className="grid grid-cols-[28px_1fr]"><span className="num text-faint">02</span>See every subscription, its true yearly cost and when it renews.</li>
              <li className="grid grid-cols-[28px_1fr]"><span className="num text-faint">03</span>Let the agent prepare payments — you approve each one in your wallet.</li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-[12px] text-alert" role="alert">{children}</p>;
}
