"use client";

import { useEffect, type ReactNode } from "react";
import { BlockProvider } from "@/lib/hooks";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <WalletProvider>
      <BlockProvider>{children}</BlockProvider>
    </WalletProvider>
  );
}
