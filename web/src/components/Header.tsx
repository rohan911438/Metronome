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
    <header
      className="sticky top-0 z-20 border-b border-line/60 bg-bg/70 px-4 backdrop-blur-xl backdrop-saturate-150"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          <span className="text-gradient text-[17px] max-[360px]:hidden">Metronome</span>
        </Link>
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[11px] capitalize text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${head > 0n ? "pulse-dot bg-buy" : "bg-muted"}`} />
          {NETWORK} {head > 0n && <span className="tabular font-mono">#{head.toString()}</span>}
        </span>
        <div className="ml-auto">
          {trader ? (
            <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-full border border-line bg-surface/80 py-1.5 pl-3 pr-1.5 text-xs shadow-sm">
              <span className="tabular whitespace-nowrap font-mono">
                {bal ? fmtQuote(bal.quote) : "…"} <span className="text-muted">{QUOTE.symbol}</span>
              </span>
              <span
                className="h-6 w-6 rounded-full ring-2 ring-accent/30"
                style={{ background: avatar(trader.address) }}
                aria-label="Account"
              />
            </button>
          ) : (
            <button onClick={() => setOpen(true)} className="whitespace-nowrap rounded-full btn-primary px-4 py-1.5 text-sm font-medium">
              {known ? "Unlock" : "Sign in"}
            </button>
          )}
        </div>
      </div>
      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </header>
  );
}

/** A gradient seeded by the address, so each account has its own recognisable avatar. */
function avatar(address: string): string {
  const h1 = parseInt(address.slice(2, 6), 16) % 360;
  const h2 = (h1 + 60 + (parseInt(address.slice(6, 8), 16) % 120)) % 360;
  return `linear-gradient(135deg, hsl(${h1} 85% 62%), hsl(${h2} 85% 55%))`;
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 drop-shadow-[0_4px_12px_var(--glow)]" aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <path d="M16 6l-7 20h14z" fill="none" stroke="var(--accent-text)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 20L22 9" stroke="var(--accent-text)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
