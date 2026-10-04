"use client";

import { useState } from "react";
import { CandleChart } from "@/components/CandleChart";
import { PerpBook } from "@/components/PerpBook";
import { PerplAccountCard } from "@/components/PerplAccountCard";
import { PerplTradeCard } from "@/components/PerplTradeCard";
import { amount, fmtInterval, fmtNum, fmtPerpPrice, perpl, scaled, sortMarkets, usePoll } from "@/lib/perpl";

const RESOLUTIONS = [
  { label: "5m", sec: 300, count: 72 },
  { label: "1h", sec: 3600, count: 72 },
  { label: "1d", sec: 86400, count: 60 },
] as const;

export default function PerpsPage() {
  const { data: ctx, error: ctxError } = usePoll(perpl.context, 60_000, "ctx");
  const { data: tickers, error: tickError } = usePoll(perpl.tickers, 1_000, "tickers");
  const markets = ctx ? sortMarkets(ctx.markets) : [];
  const [picked, setPicked] = useState<number>();
  const market = markets.find((m) => m.id === picked) ?? markets[0];
  const id = market?.id ?? null;
  const [res, setRes] = useState<(typeof RESOLUTIONS)[number]>(RESOLUTIONS[0]);

  const { data: book } = usePoll(() => perpl.book(id!, 12), 1_000, id);
  const { data: candles } = usePoll(() => perpl.candles(id!, res.sec, res.count), 10_000, id === null ? null : `${id}:${res.sec}`);

  const collateral = ctx?.tokens[0];
  const state = (market && tickers?.[market.id]) ?? market?.state;
  const pd = market?.config.price_decimals ?? 0;
  const sd = market?.config.size_decimals ?? 0;
  const change = state && state.prv ? (state.mrk / state.prv - 1) * 100 : undefined;
  const error = ctxError ?? tickError;

  return (
    <div className="space-y-4">
      <section>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Perp markets">
          {markets.map((m) => {
            const active = m.id === market?.id;
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={() => setPicked(m.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${active ? "btn-primary font-medium" : "bg-surface-2 text-muted"}`}
              >
                {m.symbol}
              </button>
            );
          })}
          {!ctx && !error && <span className="py-1.5 text-sm text-muted">Loading markets…</span>}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h1 className="text-sm text-muted">
            {market ? `${market.symbol}-PERP` : "Perps"} · {collateral?.symbol ?? "AUSD"}
          </h1>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
            on Perpl{ctx?.chain.chain_id === 10143 ? " testnet" : ""}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="tabular font-mono text-4xl font-semibold">{state ? fmtPerpPrice(state.mrk, pd) : "…"}</span>
          {change !== undefined && (
            <span className={`tabular font-mono text-sm ${change >= 0 ? "text-buy" : "text-sell"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}% <span className="text-muted">24h</span>
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Mark price{state ? <> · oracle <span className="tabular font-mono">{fmtPerpPrice(state.orl, pd)}</span></> : null}. Perpetual
          futures from Perpl&apos;s fully onchain order book on Monad.
        </p>
        {error && <p className="mt-1 text-xs text-sell">{error}</p>}
      </section>

      {market && state && (
        <section className="grid grid-cols-2 gap-2">
          <Stat label="24h volume" value={`${fmtNum(amount(state.dva, collateral?.decimals))} ${collateral?.symbol ?? ""}`} />
          <Stat
            label="Open interest"
            value={`${fmtNum(scaled(state.oi, sd))} ${market.symbol}`}
            sub={`≈ ${fmtNum(scaled(state.oi, sd) * scaled(state.mrk, pd))} ${collateral?.symbol ?? ""}`}
          />
          <Stat
            label={`Funding / ${fmtInterval(market.funding_interval_sec)}`}
            value={market.funding ? `${market.funding.rate >= 0 ? "+" : ""}${(market.funding.rate / 1e4).toFixed(4)}%` : "—"}
            tone={market.funding ? (market.funding.rate >= 0 ? "buy" : "sell") : undefined}
          />
          <Stat
            label="Fees maker / taker"
            value={`${(market.config.maker_fee / 100).toFixed(2)} / ${(market.config.taker_fee / 100).toFixed(2)} bps`}
          />
        </section>
      )}

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Price</h2>
          <div className="flex gap-1" role="group" aria-label="Candle period">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.sec}
                onClick={() => setRes(r)}
                aria-pressed={r.sec === res.sec}
                className={`rounded-full px-2.5 py-0.5 text-xs ${r.sec === res.sec ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {candles ? (
          <CandleChart candles={candles} decimals={pd} resolution={res.sec} />
        ) : (
          <div className="h-[196px] animate-pulse rounded-xl bg-surface-2" />
        )}
      </section>

      <section className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Order book</h2>
          <span className="text-[11px] text-muted">{book ? `block ${book.at.b}` : "live"}</span>
        </div>
        {book && market ? (
          <PerpBook book={book} priceDecimals={pd} sizeDecimals={sd} unit={market.symbol} />
        ) : (
          <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
        )}
      </section>

      <PerplTradeCard ctx={ctx} market={market} state={state} />

      <PerplAccountCard ctx={ctx} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "buy" | "sell" }) {
  return (
    <div className="card rounded-2xl px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`tabular mt-0.5 font-mono text-sm ${tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : ""}`}>{value}</div>
      {sub && <div className="tabular font-mono text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
