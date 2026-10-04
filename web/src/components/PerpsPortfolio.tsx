"use client";

import Link from "next/link";
import type { Address } from "viem";
import { publicClient } from "@/lib/config";
import { fmtNum, fmtPerpPrice, perpl, scaled, sortMarkets, usePoll, type PerplMarket } from "@/lib/perpl";
import { perplSetup, usePerplAccount } from "@/lib/perpl-account";
import { perplOrderAbi, toPosition, type PerpPosition } from "@/lib/perpl-trade";

/** Open positions in every open Perpl market, read on-chain in one batched round trip. */
async function loadPositions(exchange: Address, accountId: bigint, markets: PerplMarket[]) {
  const rows = await Promise.all(
    markets.map((m) =>
      publicClient.readContract({ address: exchange, abi: perplOrderAbi, functionName: "getPosition", args: [BigInt(m.id), accountId] }),
    ),
  );
  return rows.flatMap(([p, mark], i): { market: PerplMarket; pos: PerpPosition }[] => {
    const pos = toPosition(p, mark);
    return pos ? [{ market: markets[i]!, pos }] : [];
  });
}

/** The Perpl side of the portfolio: account balance and every open perp position, from the same passkey wallet. */
export function PerpsPortfolio({ owner }: { owner: Address }) {
  const { data: ctx } = usePoll(perpl.context, 60_000, "ctx");
  const setup = perplSetup(ctx);
  const { data: acct } = usePerplAccount(owner, setup);
  const accountId = acct?.account?.id;
  const markets = ctx ? sortMarkets(ctx.markets) : [];
  const { data: positions, error } = usePoll(
    () => loadPositions(setup!.exchange, accountId!, markets),
    5_000,
    setup && accountId !== undefined && markets.length ? `${setup.exchange}:${accountId}` : null,
  );

  if (!setup) return null; // Perpl isn't on this chain
  const dec = setup.collateral.decimals;
  const sym = setup.collateral.symbol;
  const fmtC = (v: bigint) => `${fmtNum(scaled(Number(v), dec), 2)} ${sym}`;

  return (
    <section className="card p-2">
      <div className="flex items-center px-2 pt-2">
        <h2 className="text-sm font-semibold">Perps on Perpl</h2>
        <Link href="/perps" className="ml-auto text-xs text-accent">
          Perps tab →
        </Link>
      </div>
      {!acct ? (
        <p className="p-2 text-xs text-muted">Loading…</p>
      ) : !acct.account ? (
        <p className="p-2 text-xs text-muted">No Perpl account yet. Open one from the Perps tab with the same wallet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 p-2 text-center">
            <div className="rounded-2xl bg-surface-2 p-2">
              <dt className="text-xs text-muted">Account #{acct.account.id.toString()}</dt>
              <dd className="tabular mt-1 font-mono text-sm">{fmtC(acct.account.balance)}</dd>
            </div>
            <div className="rounded-2xl bg-surface-2 p-2">
              <dt className="text-xs text-muted">In open positions</dt>
              <dd className="tabular mt-1 font-mono text-sm">{fmtC(acct.account.locked)}</dd>
            </div>
          </dl>
          {error && <p className="px-2 text-xs text-sell">{error}</p>}
          {!positions ? (
            <p className="p-2 text-xs text-muted">Loading positions…</p>
          ) : positions.length === 0 ? (
            <p className="p-2 text-xs text-muted">No open positions.</p>
          ) : (
            <ul className="divide-y divide-line">
              {positions.map(({ market, pos }) => {
                const { price_decimals: pd, size_decimals: sd } = market.config;
                return (
                  <li key={market.id} className="px-2 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${pos.side === "long" ? "text-buy" : "text-sell"}`}>
                        {pos.side === "long" ? "Long" : "Short"}
                      </span>
                      <span className="tabular font-mono">
                        {fmtNum(scaled(Number(pos.lots), sd), sd)} {market.symbol}
                      </span>
                      <span className={`tabular ml-auto font-mono ${pos.pnl >= 0n ? "text-buy" : "text-sell"}`}>
                        {pos.pnl >= 0n ? "+" : "−"}
                        {fmtC(pos.pnl >= 0n ? pos.pnl : -pos.pnl)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>entry {fmtPerpPrice(Number(pos.entry), pd)}</span>
                      <span>mark {fmtPerpPrice(Number(pos.mark), pd)}</span>
                      <span>margin {fmtC(pos.deposit)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
