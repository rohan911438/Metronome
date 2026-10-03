"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtNum } from "@/lib/perpl";
import { shortAddr } from "@/lib/price";

/** Shape of web/public/radar.json, written by `pnpm radar` (bots/src/radar.ts). */
interface Radar {
  generatedAt: string;
  token: { symbol: string; address: string; chain: string };
  window: { from: string; to: string };
  trades: number;
  volumeUsd: number;
  pairs: Record<string, number>;
  bots: { address: string; label: string | null; trades: number; volumeUsd: number; funder?: { address: string; name: string | null } | null }[];
  botTrades: number;
  botVolumeUsd: number;
  candidates: number;
  sandwiches: { attacker: string; label: string | null; pair: string; block: number; front: string; victim: string; back: string; victimUsd: number; profitUsd: number }[];
  credits: { used: number; remaining: number | null };
}

const SCAN = "https://monadscan.com";
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const hours = (r: Radar) => (Date.parse(r.window.to) - Date.parse(r.window.from)) / 3600_000;

export default function RadarPage() {
  const [r, setR] = useState<Radar | null>();
  useEffect(() => {
    fetch("/radar.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(setR)
      .catch(() => setR(null));
  }, []);

  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">MEV radar</h1>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">Monad mainnet · Nansen</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Who actually trades WMON on Monad&apos;s DEXs, and does anyone get sandwiched? Trades and wallet labels come from Nansen; every
          sandwich candidate is checked block by block on mainnet.
        </p>
      </section>

      {r === undefined && <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />}
      {r === null && (
        <p className="rounded-3xl border border-line bg-surface p-4 text-sm text-muted">
          No radar snapshot yet. Run <code className="font-mono">pnpm radar</code> in <code className="font-mono">bots/</code> with a
          Nansen API key.
        </p>
      )}

      {r && (
        <>
          <section className="grid grid-cols-2 gap-2">
            <Stat label={`Trades · ${fmtNum(hours(r), 1)} h`} value={r.trades.toLocaleString("en-US")} sub={`$${fmtNum(r.volumeUsd, 0)} volume`} />
            <Stat
              label="By bots"
              value={`${pct(r.botTrades, r.trades).toFixed(0)}% of trades`}
              sub={`${r.bots.length} wallets · ${pct(r.botVolumeUsd, r.volumeUsd).toFixed(0)}% of volume`}
            />
            <Stat
              label="Sandwiches (verified)"
              value={String(r.sandwiches.length)}
              sub={`${r.candidates} candidates checked on-chain`}
              tone={r.sandwiches.length ? "sell" : "buy"}
            />
            <Stat label="Victim losses" value={`$${fmtNum(r.sandwiches.reduce((s, x) => s + Math.max(0, x.profitUsd), 0))}`} sub="attacker profit, lower bound" />
          </section>

          <section className="rounded-3xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Who trades WMON</h2>
            <p className="mt-1 text-xs text-muted">
              Wallets with at least 2% of the window&apos;s trades. Labels and first funders from Nansen; a shared funder means one operator.
            </p>
            <ul className="mt-3 space-y-2.5">
              {r.bots.map((b) => {
                const share = pct(b.trades, r.trades);
                return (
                  <li key={b.address}>
                    <div className="flex items-baseline justify-between text-sm">
                      <a className="font-mono underline decoration-line" href={`${SCAN}/address/${b.address}`} target="_blank" rel="noreferrer">
                        {shortAddr(b.address)}
                      </a>
                      <span className="tabular font-mono">{share.toFixed(1)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share)}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      {b.trades.toLocaleString("en-US")} trades · ${fmtNum(b.volumeUsd, 0)} · {b.label ? `Nansen: ${b.label}` : "no Nansen label"}
                      {b.funder ? ` · funded by ${b.funder.name ?? shortAddr(b.funder.address)}` : ""}
                    </div>
                  </li>
                );
              })}
              <li className="text-[11px] text-muted">
                Everyone else: {(r.trades - r.botTrades).toLocaleString("en-US")} trades, ${fmtNum(r.volumeUsd - r.botVolumeUsd, 0)}.
              </li>
            </ul>
          </section>

          <section className="rounded-3xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Sandwiches</h2>
            {r.sandwiches.length === 0 ? (
              <p className="mt-1 text-xs text-muted">
                None in this window. {r.candidates} trade patterns looked like one (the same wallet buying and selling around someone else
                within {2} seconds), but none had all three trades in one block in front → victim → back order.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-xs">
                {r.sandwiches.map((s) => (
                  <li key={s.victim} className="rounded-2xl bg-surface-2 p-3">
                    <div className="flex justify-between">
                      <span>
                        {s.pair} · block {s.block.toLocaleString("en-US")}
                      </span>
                      <span className="tabular font-mono text-sell">${fmtNum(s.profitUsd)}</span>
                    </div>
                    <div className="mt-1 text-muted">
                      {s.label ?? shortAddr(s.attacker)} around a ${fmtNum(s.victimUsd)} trade ·{" "}
                      {(["front", "victim", "back"] as const).map((k) => (
                        <a key={k} className="mr-1.5 underline" href={`${SCAN}/tx/${s[k]}`} target="_blank" rel="noreferrer">
                          {k}
                        </a>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-line bg-surface p-4 text-xs text-muted">
            <h2 className="text-sm font-semibold text-fg">What it means for Metronome</h2>
            <p className="mt-1">
              Most WMON flow is a handful of bots racing each other to the same pools, which rewards whoever lands first in a block. On
              Metronome every order in a block clears at one price, so arriving first, or wrapping someone&apos;s trade, earns nothing.{" "}
              <Link className="text-accent underline" href="/lab">
                See the sandwich lab
              </Link>
              .
            </p>
          </section>

          <p className="text-center text-[11px] text-muted">
            Snapshot {new Date(r.generatedAt).toLocaleString()} · {r.trades.toLocaleString("en-US")} trades on {Object.keys(r.pairs).length} pairs ·{" "}
            {r.credits.used} Nansen credits
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "buy" | "sell" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`tabular mt-0.5 font-mono text-base ${tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
