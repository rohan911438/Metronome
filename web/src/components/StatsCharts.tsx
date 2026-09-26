"use client";

import { useState } from "react";

const W = 360;
const H = 170;
const PAD = { l: 4, r: 46, t: 12, b: 20 };

/** Clearing price per batch with trades: one line, crosshair + readout on hover or touch. */
export function PriceLine({
  points,
  fmtY,
  fmtX,
}: {
  points: { x: number; y: number; label: string }[];
  fmtY: (v: number) => string;
  fmtX: (x: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="flex h-[170px] items-center justify-center text-xs text-muted">Not enough trades yet.</p>;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.1 || Math.max(...ys) * 0.01;
  const y0 = Math.min(...ys) - pad;
  const y1 = Math.max(...ys) + pad;
  const x = (v: number) => PAD.l + ((v - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
  const hv = hover !== null ? points[hover] : undefined;

  return (
    <div>
      <div className="tabular mb-1 flex h-4 justify-between font-mono text-[11px] text-muted">
        {hv ? (
          <>
            <span>{hv.label}</span>
            <span className="text-fg">{fmtY(hv.y)}</span>
          </>
        ) : (
          <span>Tap the chart to read a batch</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Clearing price over the last ${points.length} batches with trades`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const vx = x0 + ((((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
          let best = 0;
          points.forEach((p, i) => Math.abs(p.x - vx) < Math.abs(points[best]!.x - vx) && (best = i));
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[y1 - (y1 - y0) * 0.1, (y0 + y1) / 2, y0 + (y1 - y0) * 0.1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={W - 2} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">
              {fmtY(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {hv && (
          <g>
            <line x1={x(hv.x)} x2={x(hv.x)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hv.x)} cy={y(hv.y)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        {[x0, x1].map((v, i) => (
          <text key={i} x={x(v)} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor={i === 0 ? "start" : "end"}>
            {fmtX(v)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** Daily totals as bars from a zero baseline, oldest on the left; hover a bar for its value. */
export function DailyBars({ days, fmt }: { days: { label: string; value: number }[]; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return <p className="text-xs text-muted">No volume yet.</p>;
  const max = Math.max(...days.map((d) => d.value), 1);
  const BH = 110;
  const slot = (W - PAD.l - 4) / Math.max(days.length, 7);
  const bw = Math.max(4, slot - 2); // 2px surface gap between adjacent bars
  const hv = hover !== null ? days[hover] : undefined;

  return (
    <div>
      <div className="tabular mb-1 flex h-4 justify-between font-mono text-[11px] text-muted">
        {hv ? (
          <>
            <span>{hv.label}</span>
            <span className="text-fg">{fmt(hv.value)}</span>
          </>
        ) : (
          <span>
            Last {days.length} day{days.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${BH + 18}`} className="w-full select-none" role="img" aria-label="Daily volume">
        <line x1={PAD.l} x2={W - 4} y1={BH} y2={BH} stroke="var(--border)" />
        {days.map((d, i) => {
          const h = Math.max(1, (d.value / max) * (BH - 8));
          const bx = PAD.l + i * slot;
          const r = Math.min(4, h / 2, bw / 2); // 4px rounded data end, smaller for tiny bars
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => setHover(i)}>
              {/* hit target taller than the bar */}
              <rect x={bx} y={0} width={slot} height={BH} fill="transparent" />
              <path
                d={`M${bx} ${BH} V${BH - h + r} q0 ${-r} ${r} ${-r} H${bx + bw - r} q${r} 0 ${r} ${r} V${BH} Z`}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? 1 : 0.5}
              />
            </g>
          );
        })}
        <text x={PAD.l} y={BH + 13} fontSize={9} fill="var(--muted)">
          {days[0]!.label}
        </text>
        {days.length > 1 && (
          <text x={PAD.l + (days.length - 1) * slot + bw} y={BH + 13} fontSize={9} fill="var(--muted)" textAnchor="end">
            {days.at(-1)!.label}
          </text>
        )}
      </svg>
    </div>
  );
}
