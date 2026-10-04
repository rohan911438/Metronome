"use client";

import { useState } from "react";
import { decodeEventLog, erc20Abi, formatUnits, maxUint256, parseEther, parseUnits, type Hex } from "viem";
import { metronomeAbi, wmonAbi } from "@/lib/abi";
import { BASE, QUOTE, deployment, explorerTx, isLocal, publicClient } from "@/lib/config";
import { useBalances } from "@/lib/hooks";
import { MAX_TICK, fmtBase, fmtPrice, fmtQuote, priceToTick, tickToPrice } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

type Mode = "protected" | "limit";
type Step = "idle" | "wrap" | "approve" | "place" | "batch" | "done" | "error";

interface Result {
  isBuy: boolean;
  resting: boolean;
  batchId: bigint;
  tick: number;
  txHash: Hex;
  ms: number;
  baseOut?: bigint;
  quoteOut?: bigint;
  escrow: bigint;
  size: bigint;
}

const SLIPPAGES = [10, 30, 100]; // bps; one tick = 10 bps
const GAS_RESERVE = parseEther("0.2");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TradeTicket({
  refTick,
  bestBid,
  bestAsk,
  band,
}: {
  refTick: number;
  bestBid?: number;
  bestAsk?: number;
  /** Ticks an order may use (the contract's price band around the last clearing price), once the market has traded. */
  band?: [number, number];
}) {
  const { trader } = useWallet();
  const { data: bal } = useBalances(trader?.address);
  const [isBuy, setIsBuy] = useState(true);
  const [mode, setMode] = useState<Mode>("protected");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(30);
  const [limitPrice, setLimitPrice] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();

  // Protected (taker) orders take the best resting price on the other side plus a slippage cap.
  const anchor = isBuy ? (bestAsk ?? refTick) : (bestBid ?? refTick);
  const takerTick = Math.min(MAX_TICK, Math.max(0, anchor + (isBuy ? 1 : -1) * (slip / 10)));
  const limitTick = limitPrice ? priceToTick(Number(limitPrice)) : undefined;
  const tick = mode === "protected" ? takerTick : limitTick;

  let size = 0n;
  try {
    size = amount ? parseUnits(amount, BASE.decimals) : 0n;
  } catch {
    size = 0n;
  }
  const px = tick !== undefined ? tickToPrice(tick) : undefined;
  const notional = px !== undefined ? Number(formatUnits(size, BASE.decimals)) * px : 0;
  const fee = mode === "protected" ? notional * 0.0005 : 0;

  const tooSmall = size > 0n && size < deployment.minOrderSize;
  const outOfBand = !!band && tick !== undefined && (tick < band[0] || tick > band[1]);
  const quoteNeeded = parseUnits((notional + fee).toFixed(QUOTE.decimals), QUOTE.decimals);
  const baseHave = bal ? bal.base + (isLocal ? 0n : bal.mon > GAS_RESERVE ? bal.mon - GAS_RESERVE : 0n) : 0n;
  const short = bal && size > 0n ? (isBuy ? bal.quote < quoteNeeded : baseHave < size) : false;
  const lowGas = bal ? bal.mon < parseEther("0.05") : false;
  const busy = step === "wrap" || step === "approve" || step === "place" || step === "batch";
  const canSubmit = !!trader && size > 0n && !tooSmall && !short && tick !== undefined && !outOfBand && !busy && !lowGas;

  async function submit() {
    if (!trader || tick === undefined || !bal) return;
    setError(undefined);
    setResult(undefined);
    const t0 = performance.now();
    const resting = mode === "limit";
    const m = deployment.address;
    try {
      // 1. Sells need WMON: wrap native MON if the WMON balance is short.
      if (!isBuy && bal.base < size) {
        setStep("wrap");
        await trader.send({ address: deployment.base, abi: wmonAbi, functionName: "deposit", args: [], value: size - bal.base });
      }
      // 2. Escrow approval (once, unlimited).
      const escrow = isBuy
        ? await publicClient.readContract({
            address: m,
            abi: metronomeAbi,
            functionName: resting ? "restingBuyEscrow" : "quoteBuyEscrow",
            args: [size, BigInt(tick)],
          })
        : size;
      const allowance = isBuy ? bal.quoteAllowance : bal.baseAllowance;
      if (allowance < escrow) {
        setStep("approve");
        await trader.send({ address: isBuy ? deployment.quote : deployment.base, abi: erc20Abi, functionName: "approve", args: [m, maxUint256] });
      }
      // 3. Place the order in this block's batch.
      setStep("place");
      const receipt = await trader.send({ address: m, abi: metronomeAbi, functionName: "placeOrder", args: [isBuy, tick, size, resting] });
      const placed = receipt.logs
        .filter((l) => l.address.toLowerCase() === m.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: metronomeAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "OrderPlaced");
      if (!placed || placed.eventName !== "OrderPlaced") throw new Error("OrderPlaced event not found");
      const { orderId, batchId } = placed.args;
      const base: Result = { isBuy, resting, batchId, tick, txHash: receipt.transactionHash, ms: 0, escrow, size };

      if (resting) {
        setResult({ ...base, ms: performance.now() - t0 });
        setStep("done");
        setAmount("");
        return;
      }
      // 4. The keeper settles the batch and pays the order out, usually within a block or two.
      setStep("batch");
      for (let i = 0; i < 120; i++) {
        const o = await publicClient.readContract({ address: m, abi: metronomeAbi, functionName: "getOrder", args: [orderId] });
        if (o.closed) break;
        await sleep(300);
      }
      const claims = await publicClient.getContractEvents({
        address: m,
        abi: metronomeAbi,
        eventName: "Claimed",
        args: { orderId },
        fromBlock: batchId,
      });
      let baseOut = 0n;
      let quoteOut = 0n;
      for (const c of claims) {
        baseOut += c.args.baseOut!;
        quoteOut += c.args.quoteOut!;
      }
      setResult({ ...base, ms: performance.now() - t0, baseOut, quoteOut });
      setStep("done");
      setAmount("");
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
      setStep("error");
    }
  }

  const label = !trader
    ? "Sign in to trade"
    : busy
      ? { wrap: "Wrapping MON…", approve: "Approving…", place: "Placing order…", batch: "Clearing batch…" }[step as "wrap"]
      : tooSmall
        ? `Minimum ${fmtBase(deployment.minOrderSize)} MON`
        : outOfBand
          ? `Price must be ${fmtPrice(tickToPrice(band![0]))}–${fmtPrice(tickToPrice(band![1]))}`
          : lowGas
            ? "Need MON for gas"
            : short
              ? `Not enough ${isBuy ? QUOTE.symbol : BASE.native}`
              : `${isBuy ? "Buy" : "Sell"} ${BASE.native}`;

  return (
    <section className="rounded-3xl border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
        {[true, false].map((b) => (
          <button
            key={String(b)}
            role="tab"
            aria-selected={isBuy === b}
            onClick={() => setIsBuy(b)}
            className={`rounded-xl py-2.5 text-sm font-semibold ${isBuy === b ? (b ? "bg-buy text-white" : "bg-sell text-white") : "text-muted"}`}
          >
            {b ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="text-xs text-muted">Amount</span>
        <div className="mt-1 flex items-center rounded-2xl bg-surface-2 px-4">
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="tabular min-w-0 flex-1 bg-transparent py-3.5 font-mono text-2xl outline-none"
          />
          <span className="text-sm text-muted">{BASE.native}</span>
        </div>
      </label>
      {bal && (
        <div className="mt-1.5 flex justify-between text-xs text-muted">
          <span>
            Balance: {isBuy ? `${fmtQuote(bal.quote)} ${QUOTE.symbol}` : `${fmtBase(bal.base)} ${BASE.symbol}${isLocal ? "" : ` + ${fmtBase(bal.mon)} MON`}`}
          </span>
          {[25, 50, 100].map((pct) => (
            <button
              key={pct}
              className="text-accent"
              onClick={() => {
                const p = px ?? tickToPrice(refTick);
                const max = isBuy ? Number(formatUnits(bal.quote, QUOTE.decimals)) / (p * 1.0006) : Number(formatUnits(baseHave, BASE.decimals));
                setAmount(Math.floor((max * pct) / 100).toString());
              }}
            >
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2 text-xs">
        {(["protected", "limit"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1.5 ${mode === m ? "bg-fg text-bg" : "bg-surface-2 text-muted"}`}
          >
            {m === "protected" ? "Now (next block)" : "Limit (rests)"}
          </button>
        ))}
      </div>

      {mode === "protected" ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Max price move</span>
            <div className="flex gap-1">
              {SLIPPAGES.map((s) => (
                <button key={s} onClick={() => setSlip(s)} className={`rounded-full px-2.5 py-1 ${slip === s ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}>
                  {s / 100}%
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            You {isBuy ? "pay at most" : "receive at least"}{" "}
            <b className="tabular font-mono text-fg">{px !== undefined ? fmtPrice(px) : "—"}</b> {QUOTE.symbol} per MON. Everyone in the batch gets the
            same price, so nobody can front-run you.
          </p>
        </div>
      ) : (
        <label className="mt-3 block">
          <span className="text-xs text-muted">Limit price ({QUOTE.symbol} per MON)</span>
          <input
            inputMode="decimal"
            placeholder={fmtPrice(tickToPrice(refTick))}
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            className="tabular mt-1 w-full rounded-2xl bg-surface-2 px-4 py-3 font-mono outline-none"
          />
          {limitTick !== undefined && (
            <span className="mt-1 block text-xs text-muted">
              Rounded to {fmtPrice(tickToPrice(limitTick))}. Makers pay no fee.
            </span>
          )}
        </label>
      )}

      {size > 0n && px !== undefined && (
        <dl className="mt-4 space-y-1 rounded-2xl bg-surface-2 p-3 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted">{isBuy ? "Max cost" : "Min proceeds"}</dt>
            <dd className="tabular font-mono">
              {(isBuy ? notional + fee : notional - fee).toLocaleString("en-US", { maximumFractionDigits: 2 })} {QUOTE.symbol}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Fee</dt>
            <dd className="tabular font-mono">{mode === "protected" ? "0.05%" : "0 (maker)"}</dd>
          </div>
          {isBuy && mode === "protected" && <p className="pt-1 text-muted">Anything not spent at the clearing price is refunded automatically.</p>}
        </dl>
      )}

      <button
        disabled={!!trader && !canSubmit}
        onClick={submit}
        className={`mt-4 w-full rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-40 ${isBuy ? "bg-buy" : "bg-sell"}`}
      >
        {label}
      </button>

      {error && <p className="mt-3 break-words text-xs text-sell">{error}</p>}
      {result && <ResultCard r={result} />}
    </section>
  );
}

function ResultCard({ r }: { r: Result }) {
  const url = explorerTx(r.txHash);
  const secs = (r.ms / 1000).toFixed(1);
  if (r.resting) {
    return (
      <div className="mt-3 rounded-2xl border border-line p-3 text-sm">
        Resting {r.isBuy ? "bid" : "ask"} for {fmtBase(r.size)} MON at {fmtPrice(tickToPrice(r.tick))}. It fills whenever a batch clears through that
        price; the keeper pays you out. Manage it in Portfolio.
      </div>
    );
  }
  const filledBase = r.isBuy ? (r.baseOut ?? 0n) : r.size - (r.baseOut ?? 0n);
  const quoteMoved = r.isBuy ? r.escrow - (r.quoteOut ?? 0n) : (r.quoteOut ?? 0n);
  const avg = filledBase > 0n ? Number(formatUnits(quoteMoved, QUOTE.decimals)) / Number(formatUnits(filledBase, BASE.decimals)) : undefined;
  return (
    <div className="mt-3 rounded-2xl border border-line p-3 text-sm">
      {filledBase > 0n ? (
        <>
          <b className={r.isBuy ? "text-buy" : "text-sell"}>
            {r.isBuy ? "Bought" : "Sold"} {fmtBase(filledBase)} MON
          </b>{" "}
          at {avg !== undefined ? fmtPrice(avg) : "—"} {QUOTE.symbol} in batch #{r.batchId.toString()}, {secs}s after you tapped.
        </>
      ) : (
        <>No counterparty in batch #{r.batchId.toString()} at your price; your funds were refunded ({secs}s).</>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-accent">
          View transaction
        </a>
      )}
    </div>
  );
}
