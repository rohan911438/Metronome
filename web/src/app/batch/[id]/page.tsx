"use client";

import Link from "next/link";
import { use } from "react";
import { DepthChart } from "@/components/DepthChart";
import { QUOTE } from "@/lib/config";
import { useBatch, useHead } from "@/lib/hooks";
import { fmtBase, fmtPrice, tickToPrice } from "@/lib/price";

const RATIONED = ["nobody (exact match)", "buyers", "sellers"];

export default function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const batchId = /^\d+$/.test(id) ? BigInt(id) : 0n;
  const head = useHead();
  const { data, error } = useBatch(batchId);
  const r = data?.result;
  const totalBuy = data?.levels.reduce((s, l) => s + l.buy, 0n) ?? 0n;
  const totalSell = data?.levels.reduce((s, l) => s + l.sell, 0n) ?? 0n;
  const fill = r && r.fillDen > 0n ? (Number(r.fillNum) / Number(r.fillDen)) * 100 : 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href={`/batch/${batchId - 1n}`} prefetch={false} className="rounded-full bg-surface-2 px-3 py-1 text-sm" aria-label="Previous batch">
          ←
        </Link>
        <h1 className="tabular font-mono text-lg font-semibold">Batch #{batchId.toString()}</h1>
        <Link
          href={`/batch/${batchId + 1n}`}
          prefetch={false}
          className={`rounded-full bg-surface-2 px-3 py-1 text-sm ${head > 0n && batchId >= head ? "pointer-events-none opacity-40" : ""}`}
          aria-label="Next batch"
        >
          →
        </Link>
      </div>
      {error && <p className="text-xs text-sell">{error}</p>}

      <section className="card p-4">
        <DepthChart levels={data?.levels ?? []} clearingTick={r?.settled && r.volume > 0n ? r.clearingTick : undefined} />
        <p className="mt-2 text-xs text-muted">
          Orders placed in this block (taker orders and new limit orders). Limit orders already resting from earlier blocks also took part but are not
          drawn here.
        </p>
      </section>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        {[
          ["Status", !r ? "…" : r.voided ? "Voided (price guard)" : r.settled ? "Settled" : batchId >= head ? "Open" : "Waiting for keeper"],
          ["Clearing price", r?.settled && r.volume > 0n ? `${fmtPrice(tickToPrice(r.clearingTick))} ${QUOTE.symbol}` : "—"],
          ["Volume", r?.settled ? `${fmtBase(r.volume, 0)} MON` : "—"],
          ["Rationed side", r?.settled && r.volume > 0n ? `${RATIONED[r.rationed] ?? r.rationed} (${fill.toFixed(1)}% filled)` : "—"],
          ["Bids in block", `${fmtBase(totalBuy, 0)} MON`],
          ["Asks in block", `${fmtBase(totalSell, 0)} MON`],
        ].map(([k, v]) => (
          <div key={k} className="card rounded-2xl p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="tabular mt-1 font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        All matched orders trade at the one clearing price. If one side has more volume at that price, that side is filled pro rata, so the order of
        transactions inside the block doesn't matter.
      </p>
    </div>
  );
}
