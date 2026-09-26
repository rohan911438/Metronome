"use client";

import { useMemo, useState } from "react";
import { type Candle, fmtPerpPrice } from "@/lib/perpl";

const W = 360;
const H = 180;
/** The right gutter holds the price labels, clear of the newest candles. */
const PAD = { l: 4, r: 46, t: 10, b: 20 };

/** OHLC candles, scaled prices as Perpl sends them. Tap or hover a candle to read it. */
export function CandleChart({ candles, decimals, resolution }: { candles: Candle[]; decimals: number; resolution: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    // Periods with no trades carry the previous close at zero range; keep them so time stays linear.
    const lo = Math.min(...candles.map((c) => c.l));
    const hi = Math.max(...candles.map((c) => c.h));
    const pad = Math.max(1, (hi - lo) * 0.08);
    return { lo: lo - pad, hi: hi + pad };
  }, [candles]);

  if (!candles.length)
    return <p className="flex h-[180px] items-center justify-center text-xs text-muted">No trades in this period.</p>;

  const { lo, hi } = model;
  const slot = (W - PAD.l - PAD.r) / candles.length;
  const x = (i: number) => PAD.l + slot * (i + 0.5);
  const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const body = Math.max(1, slot * 0.65);
  const hv = hover !== null ? candles[hover] : undefined;
  const time = (t: number) =>
    new Date(t).toLocaleString(undefined, resolution >= 86400 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="tabular mb-1 flex h-4 gap-3 font-mono text-[11px] text-muted">
        {hv ? (
          <>
            <span>{time(hv.t)}</span>
            <span>O {fmtPerpPrice(hv.o, decimals)}</span>
            <span>H {fmtPerpPrice(hv.h, decimals)}</span>
            <span>L {fmtPerpPrice(hv.l, decimals)}</span>
            <span className={hv.c >= hv.o ? "text-buy" : "text-sell"}>C {fmtPerpPrice(hv.c, decimals)}</span>
          </>
        ) : (
          <span>Tap a candle for its prices</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Price candles"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((((e.clientX - r.left) / r.width) * W - PAD.l) / slot);
          setHover(Math.min(candles.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[hi - (hi - lo) * 0.1, (hi + lo) / 2, lo + (hi - lo) * 0.1].map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={W - 2} y={y(p) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">
              {fmtPerpPrice(Math.round(p), decimals)}
            </text>
          </g>
        ))}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const col = c.n === 0 ? "var(--muted)" : up ? "var(--buy)" : "var(--sell)";
          const top = y(Math.max(c.o, c.c));
          return (
            <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.55}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(c.o, c.c)) - top)} fill={col} />
            </g>
          );
        })}
        {[0, Math.floor(candles.length / 2), candles.length - 1].map((i, k) => (
          <text key={k} x={x(i)} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>
            {time(candles[i]!.t)}
          </text>
        ))}
      </svg>
    </div>
  );
}
