"use client";
import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/db/store";
import { WalletProvider } from "@/components/wallet";
import { Shell } from "@/components/shell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <WalletProvider>
        <Shell>{children}</Shell>
      </WalletProvider>
    </StoreProvider>
  );
}
