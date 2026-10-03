/**
 * Trading on Perpl directly on-chain from the user's Metronome wallet: no API key and no origin whitelist needed.
 * Orders are `execOrder(OrderDesc)` calls on the exchange, as in PerplFoundation/dex-sdk (`crates/sdk/src/types/request.rs`):
 *
 * - orderType: 0 open long, 1 open short, 2 close long, 3 close short (close orders only reduce a position).
 * - pricePNS / lotLNS: price and size as integers scaled by the market's price_decimals / size_decimals.
 * - leverageHdths: leverage in hundredths (200 = 2x).
 * - maxMatches 1..1000 (the contract silently treats 0 as 1000), maxNegPnlCollatBPS 1000 (the SDK default).
 *
 * The app sends market orders as immediate-or-cancel limit orders at the best price plus a slippage cap, so a fill can
 * be partial but never worse than the cap, and nothing is left resting on the book.
 */
import { parseAbi, type Address } from "viem";
import { publicClient } from "./config";
import { useOnBlock } from "./hooks";
import type { Trader } from "./wallet";

export const perplOrderAbi = parseAbi([
  "struct OrderDesc { uint256 orderDescId; uint256 perpId; uint8 orderType; uint256 orderId; uint256 pricePNS; uint256 lotLNS; uint256 expiryBlock; bool postOnly; bool fillOrKill; bool immediateOrCancel; uint256 maxMatches; uint256 leverageHdths; uint256 lastExecutionBlock; uint256 amountCNS; uint256 maxNegPnlCollatBPS; }",
  "struct PositionInfo { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; }",
  "function execOrder(OrderDesc orderDesc) returns (uint256 perpId, uint256 orderId)",
  "function getPosition(uint256 perpId, uint256 accountId) view returns (PositionInfo positionInfo, uint256 markPricePNS, bool markPriceValid)",
]);

export const ORDER_TYPE = { openLong: 0, openShort: 1, closeLong: 2, closeShort: 3 } as const;
/** getPosition's positionType for a long; anything else with a size is a short. */
const LONG = 0;

/** Default cap on how far a market order may fill from the best price, in basis points. */
export const SLIPPAGE_BPS = 100;
export const LEVERAGES = [1, 2, 3, 5] as const;

export interface PerpPosition {
  side: "long" | "short";
  lots: bigint;
  entry: bigint;
  deposit: bigint;
  pnl: bigint;
  mark: bigint;
}

export function usePerpPosition(exchange: Address | undefined, perpId: number | undefined, accountId: bigint | undefined) {
  return useOnBlock(
    async (): Promise<PerpPosition | null> => {
      const [p, mark] = await publicClient.readContract({
        address: exchange!,
        abi: perplOrderAbi,
        functionName: "getPosition",
        args: [BigInt(perpId!), accountId!],
      });
      if (p.lotLNS === 0n) return null;
      return {
        side: p.positionType === LONG ? "long" : "short",
        lots: p.lotLNS,
        entry: p.pricePNS,
        deposit: p.depositCNS,
        pnl: p.pnlCNS,
        mark,
      };
    },
    [exchange, perpId, accountId],
    !!exchange && perpId !== undefined && accountId !== undefined,
  );
}

/** Worst price a market order accepts: best ask + slippage for buys, best bid − slippage for sells. */
export function limitFor(isBuy: boolean, bestBid: number, bestAsk: number, slippageBps = SLIPPAGE_BPS): bigint {
  const p = isBuy ? Math.ceil(bestAsk * (1 + slippageBps / 1e4)) : Math.floor(bestBid * (1 - slippageBps / 1e4));
  return BigInt(Math.max(1, p));
}

export interface MarketOrder {
  perpId: number;
  orderType: (typeof ORDER_TYPE)[keyof typeof ORDER_TYPE];
  lots: bigint;
  limitPNS: bigint;
  leverage: number;
}

export async function placeMarketOrder(trader: Trader, exchange: Address, o: MarketOrder) {
  return trader.send({
    address: exchange,
    abi: perplOrderAbi,
    functionName: "execOrder",
    args: [
      {
        orderDescId: BigInt(Date.now()),
        perpId: BigInt(o.perpId),
        orderType: o.orderType,
        orderId: 0n,
        pricePNS: o.limitPNS,
        lotLNS: o.lots,
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: true,
        maxMatches: 1000n,
        leverageHdths: BigInt(Math.round(o.leverage * 100)),
        lastExecutionBlock: 0n,
        amountCNS: 0n,
        maxNegPnlCollatBPS: 1000n,
      },
    ],
  });
}

/** Close the whole position at market. */
export function closeOrder(perpId: number, pos: PerpPosition, bestBid: number, bestAsk: number): MarketOrder {
  const isLong = pos.side === "long";
  return {
    perpId,
    orderType: isLong ? ORDER_TYPE.closeLong : ORDER_TYPE.closeShort,
    lots: pos.lots,
    limitPNS: limitFor(!isLong, bestBid, bestAsk),
    leverage: 1,
  };
}
