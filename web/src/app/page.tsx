"use client";

import Link from "next/link";
import { DepthChart } from "@/components/DepthChart";
import { TradeTicket } from "@/components/TradeTicket";
import { PRICE_BAND, QUOTE } from "@/lib/config";
import { useMarket } from "@/lib/hooks";
import { fmtBase, fmtPrice, tickToPrice } from "@/lib/price";

export default function TradePage() {
  const { data: mk, error } = useMarket();
  const refTick = mk ? (mk.lastClearingTick || mk.bestAsk || mk.bestBid || 2048) : 2048;
  const last = mk?.recent[0];
  const prev = mk?.recent[1];
  const change = last && prev ? (tickToPrice(last.clearingTick) / tickToPrice(prev.clearingTick) - 1) * 100 : 0;

  return (
    <div className="space-y-4">
      <section className="card-hero p-5">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-sm font-medium">
            <span className="flex -space-x-1.5">
              <span className="h-5 w-5 rounded-full bg-gradient-to-br from-accent to-accent-2 ring-2 ring-surface" />
              <span className="h-5 w-5 rounded-full bg-gradient-to-br from-buy to-sky-400 ring-2 ring-surface" />
            </span>
            MON <span className="text-muted">/ {QUOTE.symbol}</span>
          </h1>
          <span className="flex items-center gap-1 rounded-full bg-buy/12 px-2.5 py-1 text-[11px] font-medium text-buy">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            MEV-protected
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="tabular font-mono text-[2.75rem] font-semibold leading-none tracking-tight">{mk ? fmtPrice(tickToPrice(refTick)) : "…"}</span>
          {change !== 0 && (
            <span className={`tabular rounded-md px-1.5 py-0.5 font-mono text-sm ${change > 0 ? "bg-buy/12 text-buy" : "bg-sell/12 text-sell"}`}>
              {change > 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
          {[
            ["Best bid", mk?.bestBid !== undefined ? fmtPrice(tickToPrice(mk.bestBid)) : "—", "text-buy"],
            ["Best ask", mk?.bestAsk !== undefined ? fmtPrice(tickToPrice(mk.bestAsk)) : "—", "text-sell"],
            ["Last batch", last ? `#${last.batchId.toString().slice(-6)}` : "—", ""],
          ].map(([k, v, tone]) => (
            <div key={k} className="rounded-2xl bg-bg/40 px-3 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className={`tabular mt-0.5 font-mono text-sm ${tone}`}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">Every block is one batch auction: orders in the same block trade at a single clearing price.</p>
        {error && <p className="mt-1 text-xs text-sell">RPC: {error}</p>}
      </section>

      <TradeTicket
        refTick={refTick}
        bestBid={mk?.bestBid}
        bestAsk={mk?.bestAsk}
        band={mk && mk.lastSettledBatch > 0n ? [mk.lastClearingTick - PRICE_BAND, mk.lastClearingTick + PRICE_BAND] : undefined}
      />

      <section className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Order book as supply and demand</h2>
          <span className="text-[11px] text-muted">live</span>
        </div>
        <DepthChart levels={mk?.book ?? []} clearingTick={mk?.lastClearingTick || undefined} center={refTick} />
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Recent batches</h2>
        {!mk?.recent.length ? (
          <p className="text-xs text-muted">No trades in the last 100 blocks.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {mk.recent.slice(0, 8).map((s) => (
              <li key={s.batchId.toString()}>
                <Link href={`/batch/${s.batchId}`} prefetch={false} className="flex justify-between py-2">
                  <span className="tabular font-mono text-muted">#{s.batchId.toString()}</span>
                  <span className="tabular font-mono">{fmtPrice(tickToPrice(s.clearingTick))}</span>
                  <span className="tabular w-24 text-right font-mono text-muted">{fmtBase(s.volume, 0)} MON</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
