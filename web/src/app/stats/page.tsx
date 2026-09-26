"use client";

import { DailyBars, PriceLine } from "@/components/StatsCharts";
import { BASE, QUOTE, isLocal } from "@/lib/config";
import { INDEXER_URL, loadStatsPage } from "@/lib/indexer";
import { usePoll } from "@/lib/poll";
import { fmtAmount, fmtPrice, shortAddr, tickToPrice } from "@/lib/price";

/** Monad testnet/mainnet blocks are ~0.4 s; the local Anvil stack mines one per second. */
const BLOCK_SECONDS = isLocal ? 1 : 0.4;

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const quote = (raw: string) => Number(raw) / 10 ** QUOTE.decimals;
const base = (raw: string) => Number(BigInt(raw) / 10n ** 15n) / 1000;
const avgGas = (sum: string, n: number) => (n ? Math.round(Number(sum) / n).toLocaleString("en-US") : "—");

export default function StatsPage() {
  const { data, error } = usePoll(loadStatsPage, 3_000, INDEXER_URL ? "stats" : null);
  const s = data?.Stats[0];

  if (!INDEXER_URL)
    return (
      <Intro>
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          Stats come from the Metronome indexer, which isn&apos;t configured for this build. Set <code className="font-mono">NEXT_PUBLIC_INDEXER_URL</code> to its
          GraphQL endpoint. Trading doesn&apos;t need it.
        </p>
      </Intro>
    );

  if (!s)
    return (
      <Intro>
        {error ? (
          <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
            Can&apos;t reach the indexer ({error}). {isLocal && <>Start it with <code className="font-mono">docker compose up</code> in <code className="font-mono">indexer/</code>.</>}
          </p>
        ) : data ? (
          <p className="text-sm text-muted">No trades indexed yet.</p>
        ) : (
          <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />
        )}
      </Intro>
    );

  const delayBlocks = s.settleDelaySamples ? Number(s.settleDelayBlocksSum) / s.settleDelaySamples : 0;
  const batches = [...(data?.Batch ?? [])].reverse();
  const days = [...(data?.DailyStats ?? [])].reverse();

  return (
    <Intro>
      <section className="grid grid-cols-2 gap-2">
        <Tile label="Volume" value={`${compact(quote(s.volumeQuote))} ${QUOTE.symbol}`} sub={`${compact(base(s.volumeBase))} ${BASE.native}`} />
        <Tile label="Batches with trades" value={compact(s.batchesWithTrades)} sub={`of ${compact(s.batchesSettled)} settled`} />
        <Tile label="Orders" value={compact(s.orders)} sub={`${compact(s.takerOrders)} now · ${compact(s.restingOrders)} limit`} />
        <Tile label="Traders" value={compact(s.traders)} sub={`${compact(s.claims)} claims · ${compact(s.cancels)} cancels`} />
        <Tile
          label="Order to settlement"
          value={`${delayBlocks.toFixed(2)} blocks`}
          sub={`≈ ${(delayBlocks * BLOCK_SECONDS).toFixed(1)} s`}
        />
        <Tile label="Keeper rewards paid" value={`${fmtAmount(BigInt(s.keeperRewards), QUOTE.decimals)} ${QUOTE.symbol}`} />
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Clearing price per batch</h2>
        <PriceLine
          points={batches.map((b) => ({ x: Number(b.id), y: tickToPrice(b.clearingTick), label: `Batch #${b.id} · ${compact(base(b.volume))} ${BASE.native}` }))}
          fmtY={fmtPrice}
          fmtX={(x) => `#${x}`}
        />
        <p className="mt-1 text-[11px] text-muted">Every trader in a batch got this one price. Last {batches.length} batches with trades.</p>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Daily volume ({QUOTE.symbol})</h2>
        <DailyBars days={days.map((d) => ({ label: d.id.slice(5), value: quote(d.volumeQuote) }))} fmt={(v) => `${compact(v)} ${QUOTE.symbol}`} />
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Gas per transaction</h2>
        <table className="tabular w-full font-mono text-xs">
          <thead className="text-left text-[11px] text-muted">
            <tr>
              <th className="pb-1 font-normal">Action</th>
              <th className="pb-1 text-right font-normal">Avg gas</th>
              <th className="pb-1 text-right font-normal">Txs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(
              [
                ["Place order", s.gasPlaceSum, s.gasPlaceTxs],
                ["Settle (+ claims)", s.gasSettleSum, s.gasSettleTxs],
                ["Claim", s.gasClaimSum, s.gasClaimTxs],
                ["Cancel", s.gasCancelSum, s.gasCancelTxs],
              ] as const
            ).map(([label, sum, n]) => (
              <tr key={label}>
                <td className="py-1.5 font-sans">{label}</td>
                <td className="py-1.5 text-right">{avgGas(sum, n)}</td>
                <td className="py-1.5 text-right text-muted">{compact(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted">A transaction counts under its first Metronome event. Settles usually claim the batch&apos;s orders in the same transaction.</p>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Keepers</h2>
        {data!.Keeper.length ? (
          <ol className="divide-y divide-line text-sm">
            {data!.Keeper.map((k, i) => (
              <li key={k.id} className="flex items-baseline gap-3 py-2">
                <span className="w-4 text-muted">{i + 1}</span>
                <span className="font-mono">{shortAddr(k.id)}</span>
                <span className="tabular ml-auto font-mono">{compact(k.batchesSettled)} batches</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted">No batches settled yet.</p>
        )}
        <p className="mt-1 text-[11px] text-muted">Anyone can settle a batch. Keepers are the addresses that sent settle transactions.</p>
      </section>

      <p className="text-center text-[11px] text-muted">
        Indexed by Envio HyperIndex up to block <span className="tabular font-mono">{s.lastBlock}</span>
        {error && <span className="text-sell"> · last refresh failed</span>}
      </p>
    </Intro>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-sm text-muted">Exchange stats</h1>
        <p className="mt-1 text-xs text-muted">All-time numbers for Metronome, from our Envio indexer.</p>
      </section>
      {children}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular mt-0.5 font-mono text-base">{value}</div>
      {sub && <div className="tabular font-mono text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
