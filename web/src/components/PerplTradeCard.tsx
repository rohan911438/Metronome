"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { chain, explorerTx, isFork } from "@/lib/config";
import { fmtNum, fmtPerpPrice, scaled, type MarketState, type PerplContext, type PerplMarket } from "@/lib/perpl";
import { perplSetup, usePerplAccount } from "@/lib/perpl-account";
import {
  LEVERAGES,
  ORDER_TYPE,
  SLIPPAGE_BPS,
  closeOrder,
  limitFor,
  placeMarketOrder,
  usePerpPosition,
  type MarketOrder,
} from "@/lib/perpl-trade";
import { fmtAmount } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

/** Perpl reverts with this (perpId, oracle time, now, max age) when its oracle price is older than the market allows. */
const STALE_PRICE = "0x7d19aaec";

/**
 * Market orders on the selected Perpl market, sent on-chain from the passkey wallet (one transaction, no popup), and the
 * open position with a one-tap close. Shown once the wallet has a Perpl account on the app's chain.
 */
export function PerplTradeCard({ ctx, market, state }: { ctx: PerplContext | undefined; market?: PerplMarket; state?: MarketState }) {
  const { trader } = useWallet();
  const setup = perplSetup(ctx);
  const { data: acct } = usePerplAccount(trader?.address, setup);
  const accountId = acct?.account?.id;
  const { data: pos } = usePerpPosition(setup?.exchange, market?.id, accountId);
  const [side, setSide] = useState<"long" | "short">("long");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState<number>(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [last, setLast] = useState<{ label: string; hash: Hex }>();

  if (!ctx || !setup || !trader || !market || !state || accountId === undefined || ctx.chain.chain_id !== chain.id) return null;

  const token = setup.collateral;
  const pd = market.config.price_decimals;
  const sd = market.config.size_decimals;
  const fmtC = (v: bigint) => `${fmtAmount(v, token.decimals)} ${token.symbol}`;
  const lots = (() => {
    const n = Number(size);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 10 ** sd)) : 0n;
  })();
  const isBuy = side === "long";
  const refPrice = scaled(isBuy ? state.ask : state.bid, pd);
  const notional = scaled(Number(lots), sd) * refPrice;
  const margin = notional / leverage;
  const available = Number(acct!.account!.balance) / 10 ** token.decimals;
  const tooBig = margin > available;

  async function send(label: string, order: MarketOrder) {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await placeMarketOrder(trader!, setup!.exchange, order);
      setLast({ label, hash: r.transactionHash });
      setSize("");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(
        msg.includes(STALE_PRICE)
          ? isFork
            ? "Perpl's oracle price is over a minute old: on a local fork nobody updates it. Restart the fork (pnpm perpl:fork) and trade right away."
            : "Perpl's oracle price is momentarily stale. Try again in a few seconds."
          : msg.split("\n")[0],
      );
    } finally {
      setBusy(false);
    }
  }

  const unit = market.symbol;
  return (
    <section className="space-y-4 card p-4 text-xs text-muted">
      <h2 className="text-sm font-semibold text-fg">Trade {unit}-PERP</h2>

      {pos && (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className={`font-medium ${pos.side === "long" ? "text-buy" : "text-sell"}`}>
              {pos.side === "long" ? "Long" : "Short"} {fmtNum(scaled(Number(pos.lots), sd), sd)} {unit}
            </span>
            <span className={`tabular font-mono ${pos.pnl >= 0n ? "text-buy" : "text-sell"}`}>
              {pos.pnl >= 0n ? "+" : "−"}
              {fmtC(pos.pnl >= 0n ? pos.pnl : -pos.pnl)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>
              Entry <span className="tabular font-mono text-fg">{fmtPerpPrice(Number(pos.entry), pd)}</span> · mark{" "}
              <span className="tabular font-mono text-fg">{fmtPerpPrice(Number(pos.mark), pd)}</span>
            </span>
            <span>
              Margin <span className="tabular font-mono text-fg">{fmtC(pos.deposit)}</span>
            </span>
          </div>
          <button
            disabled={busy}
            onClick={() => send("Closed position", closeOrder(market.id, pos, state.bid, state.ask))}
            className="w-full rounded-xl bg-surface py-2 text-sm text-fg disabled:opacity-50"
          >
            {busy ? "Sending…" : "Close at market"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="group" aria-label="Side">
        {(["long", "short"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={`rounded-xl py-2 text-sm font-medium ${side === s ? (s === "long" ? "bg-buy text-white" : "bg-sell text-white") : "text-muted"}`}
          >
            {s === "long" ? "Long" : "Short"}
          </button>
        ))}
      </div>

      <label className="block">
        <span>Size ({unit})</span>
        <input
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder={sd === 0 ? "1000" : "0.1"}
          className="tabular mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-base text-fg"
        />
      </label>

      <div>
        <span>Leverage</span>
        <div className="mt-1 flex gap-1" role="group" aria-label="Leverage">
          {LEVERAGES.map((l) => (
            <button
              key={l}
              onClick={() => setLeverage(l)}
              aria-pressed={leverage === l}
              className={`flex-1 rounded-xl py-1.5 text-sm ${leverage === l ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}
            >
              {l}×
            </button>
          ))}
        </div>
      </div>

      <dl className="space-y-1">
        <Row label="Notional" value={lots ? `≈ ${fmtNum(notional)} ${token.symbol}` : "—"} />
        <Row label="Margin" value={lots ? `≈ ${fmtNum(margin)} ${token.symbol}` : "—"} warn={tooBig} />
        <Row label="Account balance" value={fmtC(acct!.account!.balance)} />
        <Row label="Worst fill" value={`${fmtPerpPrice(Number(limitFor(isBuy, state.bid, state.ask)), pd)} (${SLIPPAGE_BPS / 100}% cap)`} />
      </dl>

      <button
        disabled={busy || lots === 0n || tooBig}
        onClick={() =>
          send(`${isBuy ? "Long" : "Short"} ${size} ${unit}`, {
            perpId: market.id,
            orderType: isBuy ? ORDER_TYPE.openLong : ORDER_TYPE.openShort,
            lots,
            limitPNS: limitFor(isBuy, state.bid, state.ask),
            leverage,
          })
        }
        className={`w-full rounded-2xl py-3 text-base font-medium text-white disabled:opacity-50 ${isBuy ? "btn-buy" : "btn-sell"}`}
      >
        {busy ? "Sending…" : tooBig ? "Not enough margin" : `${isBuy ? "Long" : "Short"} ${unit} at market`}
      </button>

      {last && (
        <p>
          {last.label}:{" "}
          {explorerTx(last.hash) ? (
            <a className="text-accent underline" href={explorerTx(last.hash)} target="_blank" rel="noreferrer">
              view transaction
            </a>
          ) : (
            <span className="font-mono">{last.hash.slice(0, 10)}…</span>
          )}
        </p>
      )}
      {err && <p className="break-words text-sell">{err}</p>}
      <p>
        Market orders are immediate-or-cancel: whatever can&apos;t fill within the cap is dropped, never left on the book. Sent
        straight to Perpl&apos;s exchange contract from your passkey wallet.
      </p>
    </section>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={`tabular font-mono ${warn ? "text-sell" : "text-fg"}`}>{value}</dd>
    </div>
  );
}
