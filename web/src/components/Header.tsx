"use client";

import Link from "next/link";
import { useState } from "react";
import { NETWORK, QUOTE } from "@/lib/config";
import { useBalances, useHead } from "@/lib/hooks";
import { fmtQuote } from "@/lib/price";
import { useWallet } from "@/lib/wallet";
import { AccountSheet } from "./AccountSheet";

export function Header() {
  const head = useHead();
  const { trader, known } = useWallet();
  const { data: bal } = useBalances(trader?.address);
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 bg-bg/90 px-4 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex h-14 items-center gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          <span className="max-[360px]:hidden">Metronome</span>
        </Link>
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${head > 0n ? "pulse-dot bg-buy" : "bg-muted"}`} />
          {NETWORK} {head > 0n && <span className="tabular font-mono">#{head.toString()}</span>}
        </span>
        <div className="ml-auto">
          {trader ? (
            <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full bg-surface-2 py-1.5 pl-3 pr-2 text-xs">
              <span className="tabular whitespace-nowrap font-mono">
                {bal ? fmtQuote(bal.quote) : "…"} <span className="text-muted">{QUOTE.symbol}</span>
              </span>
              <span className="h-5 w-5 rounded-full bg-accent" aria-label="Account" />
            </button>
          ) : (
            <button onClick={() => setOpen(true)} className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg">
              {known ? "Unlock" : "Sign in"}
            </button>
          )}
        </div>
      </div>
      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </header>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M16 6l-7 20h14z" fill="none" stroke="var(--accent-text)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 20L22 9" stroke="var(--accent-text)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
