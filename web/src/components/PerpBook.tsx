"use client";

import { type Book, type BookLevel, fmtNum, fmtPerpPrice, scaled } from "@/lib/perpl";

/** Perpl's L2 book: asks above, bids below, bars show cumulative size from the spread. */
export function PerpBook({
  book,
  priceDecimals,
  sizeDecimals,
  unit,
  rows = 8,
}: {
  book: Book;
  priceDecimals: number;
  sizeDecimals: number;
  unit: string;
  rows?: number;
}) {
  const asks = book.ask.slice(0, rows);
  const bids = book.bid.slice(0, rows);
  const cum = (ls: BookLevel[]) => ls.reduce<number[]>((acc, l) => [...acc, (acc.at(-1) ?? 0) + l.s], []);
  const askCum = cum(asks);
  const bidCum = cum(bids);
  const max = Math.max(1, askCum.at(-1) ?? 0, bidCum.at(-1) ?? 0);
  const bestBid = bids[0]?.p;
  const bestAsk = asks[0]?.p;
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : undefined;

  const row = (l: BookLevel, total: number, side: "bid" | "ask") => (
    <li key={`${side}${l.p}`} className="relative flex justify-between px-1 py-0.5">
      <span
        className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-buy/15" : "bg-sell/15"}`}
        style={{ width: `${(total / max) * 100}%` }}
        aria-hidden
      />
      <span className={`relative ${side === "bid" ? "text-buy" : "text-sell"}`}>{fmtPerpPrice(l.p, priceDecimals)}</span>
      <span className="relative">{fmtNum(scaled(l.s, sizeDecimals))}</span>
    </li>
  );

  if (!asks.length && !bids.length) return <p className="text-xs text-muted">The book is empty.</p>;

  return (
    <div className="tabular font-mono text-xs">
      <div className="flex justify-between px-1 pb-1 text-[11px] text-muted">
        <span>Price</span>
        <span>Size ({unit})</span>
      </div>
      <ul className="flex flex-col-reverse">{asks.map((l, i) => row(l, askCum[i]!, "ask"))}</ul>
      <div className="my-1 flex justify-between border-y border-line px-1 py-1 text-[11px] text-muted">
        <span>Spread</span>
        <span>
          {spread !== undefined
            ? `${fmtPerpPrice(spread, priceDecimals)} (${((spread / ((bestAsk! + bestBid!) / 2)) * 1e4).toFixed(1)} bps)`
            : "—"}
        </span>
      </div>
      <ul>{bids.map((l, i) => row(l, bidCum[i]!, "bid"))}</ul>
    </div>
  );
}
