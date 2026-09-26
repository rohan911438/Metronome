"use client";

import { useMemo, useState } from "react";
import type { Level } from "@/lib/hooks";
import { fmtPrice, tickToPrice } from "@/lib/price";

const W = 360;
const H = 200;
const PAD = { l: 8, r: 8, t: 12, b: 26 };

/**
 * Supply and demand for one batch: cumulative base wanted at or above each price (demand, falls to the right) and
 * offered at or below it (supply, rises). The batch clears where they cross, and everyone trades at that one price.
 */
export function DepthChart({
  levels,
  clearingTick,
  center,
  span = 40,
}: {
  levels: Level[];
  clearingTick?: number;
  center?: number;
  span?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const active = levels.filter((l) => l.buy > 0n || l.sell > 0n);
    const mid = center ?? clearingTick ?? (active.length ? active[Math.floor(active.length / 2)]!.tick : 2048);
    const lo = Math.max(0, mid - span);
    const hi = Math.min(4095, mid + span);
    const ticks: number[] = [];
    for (let t = lo; t <= hi; t++) ticks.push(t);

    // Orders outside the window still count toward the cumulative totals.
    const toNum = (x: bigint) => Number(x / 10n ** 15n) / 1000; // base units → MON with 3 decimals
    const demand = ticks.map((t) => active.filter((l) => l.tick >= t).reduce((s, l) => s + toNum(l.buy), 0));
    const supply = ticks.map((t) => active.filter((l) => l.tick <= t).reduce((s, l) => s + toNum(l.sell), 0));
    const max = Math.max(1, ...demand, ...supply);
    return { ticks, demand, supply, max, lo, hi };
  }, [levels, clearingTick, center, span]);

  const { ticks, demand, supply, max, lo, hi } = model;
  const x = (t: number) => PAD.l + ((t - lo) / Math.max(1, hi - lo)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const step = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "H"}${x(ticks[i]!).toFixed(1)}${i === 0 ? ` ${y(v).toFixed(1)}` : ` V${y(v).toFixed(1)}`}`).join(" ");
  const area = (vals: number[]) => `${step(vals)} V${y(0)} H${x(ticks[0]!)} Z`;

  const empty = demand[0] === 0 && supply[supply.length - 1] === 0;
  const hv = hover !== null ? { t: ticks[hover]!, d: demand[hover]!, s: supply[hover]! } : null;
  const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : v.toFixed(0));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Supply and demand curves for the batch"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (ticks.length - 1));
          setHover(Math.min(ticks.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        {!empty && (
          <>
            <path d={area(demand)} fill="var(--buy)" opacity={0.12} />
            <path d={area(supply)} fill="var(--sell)" opacity={0.12} />
            <path d={step(demand)} fill="none" stroke="var(--buy)" strokeWidth={2} />
            <path d={step(supply)} fill="none" stroke="var(--sell)" strokeWidth={2} />
          </>
        )}
        {clearingTick !== undefined && clearingTick >= lo && clearingTick <= hi && (
          <g>
            <line x1={x(clearingTick)} x2={x(clearingTick)} y1={PAD.t} y2={y(0)} stroke="var(--text)" strokeDasharray="3 3" />
            <text x={x(clearingTick)} y={PAD.t - 2} textAnchor="middle" fontSize={10} fill="var(--text)">
              clears {fmtPrice(tickToPrice(clearingTick))}
            </text>
          </g>
        )}
        {hv && <line x1={x(hv.t)} x2={x(hv.t)} y1={PAD.t} y2={y(0)} stroke="var(--muted)" strokeWidth={1} />}
        {[lo, Math.round((lo + hi) / 2), hi].map((t, i) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={10} fill="var(--muted)" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>
            {fmtPrice(tickToPrice(t))}
          </text>
        ))}
        {empty && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="var(--muted)">
            No orders near this price yet
          </text>
        )}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <i className="inline-block h-0.5 w-3 bg-buy" /> Demand (buyers)
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-0.5 w-3 bg-sell" /> Supply (sellers)
        </span>
        {hv && (
          <span className="tabular ml-auto font-mono text-fg">
            {fmtPrice(tickToPrice(hv.t))}: {fmtK(hv.d)} / {fmtK(hv.s)}
          </span>
        )}
      </div>
    </div>
  );
}
