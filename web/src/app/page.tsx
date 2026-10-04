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
      <section>
        <div className="flex items-baseline justify-between">
          <h1 className="text-sm text-muted">MON / {QUOTE.symbol}</h1>
          <span className="rounded-full bg-buy/15 px-2 py-0.5 text-[11px] font-medium text-buy">MEV-protected</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="tabular font-mono text-4xl font-semibold">{mk ? fmtPrice(tickToPrice(refTick)) : "…"}</span>
          {change !== 0 && (
            <span className={`tabular font-mono text-sm ${change > 0 ? "text-buy" : "text-sell"}`}>
              {change > 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Every block is one batch auction: orders in the same block trade at a single clearing price.
        </p>
        {error && <p className="mt-1 text-xs text-sell">RPC: {error}</p>}
      </section>

      <TradeTicket
        refTick={refTick}
        bestBid={mk?.bestBid}
        bestAsk={mk?.bestAsk}
        band={mk && mk.lastSettledBatch > 0n ? [mk.lastClearingTick - PRICE_BAND, mk.lastClearingTick + PRICE_BAND] : undefined}
      />

      <section className="rounded-3xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Order book as supply and demand</h2>
          <span className="text-[11px] text-muted">live</span>
        </div>
        <DepthChart levels={mk?.book ?? []} clearingTick={mk?.lastClearingTick || undefined} center={refTick} />
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
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
