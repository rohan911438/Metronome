"use client";

import Link from "next/link";
import { useState } from "react";
import { PerpsPortfolio } from "@/components/PerpsPortfolio";
import { metronomeAbi } from "@/lib/abi";
import { BASE, QUOTE, deployment } from "@/lib/config";
import { useBalances, usePortfolio, type PortfolioOrder } from "@/lib/hooks";
import { fmtBase, fmtPrice, fmtQuote, tickToPrice } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

function status(o: PortfolioOrder): { text: string; tone: "muted" | "buy" | "warn" } {
  if (o.cancelled) return { text: "Cancelled", tone: "muted" };
  if (!o.resting) {
    if (!o.settled) return { text: "In batch", tone: "warn" };
    if (!o.closed) return { text: "Paying out", tone: "warn" };
    const filled = o.isBuy ? o.baseOut > 0n : o.quoteOut > 0n;
    return filled ? { text: "Filled", tone: "buy" } : { text: "Refunded", tone: "muted" };
  }
  if (o.closed) return { text: "Filled", tone: "buy" };
  return { text: "Resting", tone: "warn" };
}

export default function PortfolioPage() {
  const { trader } = useWallet();
  const { data: bal } = useBalances(trader?.address);
  const { data: orders, error } = usePortfolio(trader?.address);
  const [cancelling, setCancelling] = useState<string>();
  const [cancelErr, setCancelErr] = useState<string>();

  if (!trader) {
    return <p className="mt-10 text-center text-sm text-muted">Sign in to see your orders.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Portfolio</h1>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          [BASE.native, bal ? fmtBase(bal.mon) : "…"],
          [BASE.symbol, bal ? fmtBase(bal.base) : "…"],
          [QUOTE.symbol, bal ? fmtQuote(bal.quote) : "…"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-line bg-surface p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="tabular mt-1 truncate font-mono text-sm">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-3xl border border-line bg-surface p-2">
        <h2 className="px-2 pt-2 text-sm font-semibold">Orders</h2>
        {error && <p className="px-2 text-xs text-sell">{error}</p>}
        {cancelErr && <p className="px-2 text-xs text-sell">Cancel failed: {cancelErr}</p>}
        {!orders ? (
          <p className="p-2 text-xs text-muted">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="p-2 text-xs text-muted">No orders yet. Place one from the Trade tab.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map((o) => {
              const s = status(o);
              const fillPx = o.settled && !o.resting ? fmtPrice(tickToPrice(o.clearingTick)) : null;
              return (
                <li key={o.id} className="px-2 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${o.isBuy ? "text-buy" : "text-sell"}`}>{o.isBuy ? "Buy" : "Sell"}</span>
                    <span className="tabular font-mono">{fmtBase(o.size)} MON</span>
                    <span className="text-xs text-muted">{o.resting ? "limit" : "now"}</span>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
                        s.tone === "buy" ? "bg-buy/15 text-buy" : s.tone === "warn" ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {s.text}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>
                      {o.resting ? "at" : "limit"} {fmtPrice(tickToPrice(o.tick))}
                    </span>
                    {fillPx && <span>cleared {fillPx}</span>}
                    {/* A buy is filled in MON and refunded in AUSD; a sell the other way round. */}
                    {(o.isBuy ? o.baseOut : o.quoteOut) > 0n && (
                      <span>
                        {o.closed ? "got" : "claimable"} {o.isBuy ? `${fmtBase(o.baseOut)} MON` : `${fmtQuote(o.quoteOut)} ${QUOTE.symbol}`}
                      </span>
                    )}
                    {(o.isBuy ? o.quoteOut : o.baseOut) > 0n && (
                      <span>refunded {o.isBuy ? `${fmtQuote(o.quoteOut)} ${QUOTE.symbol}` : `${fmtBase(o.baseOut)} MON`}</span>
                    )}
                    <Link href={`/batch/${o.batchId}`} prefetch={false} className="text-accent">
                      batch #{o.batchId.toString()}
                    </Link>
                  </div>
                  {o.resting && !o.closed && (
                    <button
                      disabled={cancelling === o.id}
                      onClick={async () => {
                        setCancelling(o.id);
                        setCancelErr(undefined);
                        try {
                          await trader.send({ address: deployment.address, abi: metronomeAbi, functionName: "cancel", args: [o.id] });
                        } catch (e) {
                          setCancelErr((e as Error).message.split("\n")[0]);
                        } finally {
                          setCancelling(undefined);
                        }
                      }}
                      className="mt-2 rounded-full bg-surface-2 px-3 py-1 text-xs disabled:opacity-50"
                    >
                      {cancelling === o.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="px-1 text-xs text-muted">
        You never press claim: the keeper settles each batch and pays every order out, usually in the next block.
      </p>
      <PerpsPortfolio owner={trader.address} />
    </div>
  );
}

