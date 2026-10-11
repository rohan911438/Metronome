"use client";

import { useEffect, type ReactNode } from "react";
import { KEEPER_URL } from "@/lib/config";
import { BlockProvider } from "@/lib/hooks";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Keep the hosted keeper awake while the app is open (a sleeping free instance would leave batches unsettled).
  useEffect(() => {
    if (!KEEPER_URL) return;
    const ping = () => fetch(`${KEEPER_URL}/health`, { cache: "no-store" }).catch(() => {});
    ping();
    const id = setInterval(ping, 4 * 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <WalletProvider>
      <BlockProvider>{children}</BlockProvider>
    </WalletProvider>
  );
}
