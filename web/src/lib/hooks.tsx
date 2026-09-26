"use client";

/**
 * Live chain data. There is no backend or indexer: everything is read over RPC once per block.
 * `useOnBlock` re-runs a loader on every new head, never overlapping itself.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { encodeAbiParameters, erc20Abi, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import { metronomeAbi } from "./abi";
import { LOG_CHUNK, POLL_MS, deployment, publicClient } from "./config";

const HeadCtx = createContext<bigint>(0n);

export function BlockProvider({ children }: { children: ReactNode }) {
  const [head, setHead] = useState(0n);
  useEffect(
    () =>
      publicClient.watchBlockNumber({
        onBlockNumber: (b) => setHead(b),
        onError: (e) => console.warn("block watch", e.message),
        pollingInterval: POLL_MS,
        emitMissed: false,
      }),
    [],
  );
  return <HeadCtx.Provider value={head}>{children}</HeadCtx.Provider>;
}

export const useHead = () => useContext(HeadCtx);

/** Runs `load` on mount, on every new block and whenever `deps` change; keeps the last good value. */
export function useOnBlock<T>(load: (head: bigint) => Promise<T>, deps: unknown[] = [], enabled = true) {
  const head = useHead();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const key = JSON.stringify(deps, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const lastKey = useRef(key);

  useEffect(() => {
    if (!enabled || head === 0n) return;
    const changed = lastKey.current !== key;
    lastKey.current = key;
    if (busy.current && !changed) return;
    if (changed) setData(undefined);
    busy.current = true;
    const stale = () => lastKey.current !== key; // deps changed while this load was in flight
    load(head)
      .then((d) => {
        if (!stale()) {
          setData(d);
          setError(undefined);
        }
      })
      .catch((e: Error) => !stale() && setError(e.message.split("\n")[0]))
      .finally(() => {
        busy.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head, key, enabled]);

  return { data, error, head };
}

const m = { address: deployment.address, abi: metronomeAbi } as const;

export interface Level {
  tick: number;
  buy: bigint;
  sell: bigint;
}

function mergeLevels(...books: (readonly [readonly number[], readonly bigint[], readonly bigint[]])[]): Level[] {
  const byTick = new Map<number, Level>();
  for (const [ticks, buys, sells] of books) {
    ticks.forEach((t, i) => {
      const l = byTick.get(t) ?? { tick: t, buy: 0n, sell: 0n };
      l.buy += buys[i]!;
      l.sell += sells[i]!;
      byTick.set(t, l);
    });
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

const batchSettledEvent = parseAbiItem(
  "event BatchSettled(uint256 indexed batchId, uint16 clearingTick, uint256 price, uint128 volume, uint8 rationed, uint128 fillNum, uint128 fillDen, bool voided)",
);

export interface Settlement {
  batchId: bigint;
  clearingTick: number;
  volume: bigint;
  voided: boolean;
}

/** Market state: last clearing price, the book (resting pools + the latest batch's own orders), recent trades. */
export function useMarket() {
  const recent = useRef<Settlement[]>([]);
  const scannedTo = useRef(0n);

  return useOnBlock(async (head) => {
    const [lastClearingTick, lastSettledBatch, resting, latest] = await Promise.all([
      publicClient.readContract({ ...m, functionName: "lastClearingTick" }),
      publicClient.readContract({ ...m, functionName: "lastSettledBatch" }),
      publicClient.readContract({ ...m, functionName: "getRestingBook" }),
      publicClient.readContract({ ...m, functionName: "getBatchBook", args: [head] }),
    ]);

    // Settlements with volume in the last LOG_CHUNK blocks, scanned incrementally.
    const from = scannedTo.current > 0n ? scannedTo.current + 1n : head > LOG_CHUNK ? head - LOG_CHUNK + 1n : 0n;
    if (from <= head) {
      const logs = await publicClient.getLogs({ address: deployment.address, event: batchSettledEvent, fromBlock: from, toBlock: head });
      for (const l of logs) {
        if (l.args.volume! > 0n) {
          recent.current.unshift({
            batchId: l.args.batchId!,
            clearingTick: l.args.clearingTick!,
            volume: l.args.volume!,
            voided: l.args.voided!,
          });
        }
      }
      recent.current = recent.current.slice(0, 30);
      scannedTo.current = head;
    }

    const restingLevels = mergeLevels(resting);
    const bestBid = [...restingLevels].reverse().find((l) => l.buy > 0n)?.tick;
    const bestAsk = restingLevels.find((l) => l.sell > 0n)?.tick;
    return {
      lastClearingTick,
      lastSettledBatch: BigInt(lastSettledBatch),
      book: mergeLevels(resting, latest),
      bestBid,
      bestAsk,
      recent: [...recent.current],
      head,
    };
  });
}

/** One batch: its own orders (taker + newly placed resting) and its result. */
export function useBatch(batchId: bigint) {
  return useOnBlock(async () => {
    const [book, result] = await Promise.all([
      publicClient.readContract({ ...m, functionName: "getBatchBook", args: [batchId] }),
      publicClient.readContract({ ...m, functionName: "getBatchResult", args: [batchId] }),
    ]);
    return { levels: mergeLevels(book), result };
  }, [batchId]);
}

export function useBalances(owner?: Address) {
  return useOnBlock(
    async () => {
      const a = owner!;
      const [mon, base, quote, baseAllowance, quoteAllowance] = await Promise.all([
        publicClient.getBalance({ address: a }),
        publicClient.readContract({ address: deployment.base, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
        publicClient.readContract({ address: deployment.quote, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
        publicClient.readContract({ address: deployment.base, abi: erc20Abi, functionName: "allowance", args: [a, deployment.address] }),
        publicClient.readContract({ address: deployment.quote, abi: erc20Abi, functionName: "allowance", args: [a, deployment.address] }),
      ]);
      return { mon, base, quote, baseAllowance, quoteAllowance };
    },
    [owner],
    !!owner,
  );
}

/** Order IDs are keccak256(abi.encode(owner, nonce)), so a user's orders are found from `nonces(owner)` alone. */
export const orderIdOf = (owner: Address, nonce: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, nonce]));

const claimedEvent = parseAbiItem(
  "event Claimed(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut, bool closed)",
);
const cancelledEvent = parseAbiItem(
  "event OrderCancelled(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut)",
);

export interface PortfolioOrder {
  id: Hex;
  nonce: bigint;
  batchId: bigint;
  tick: number;
  isBuy: boolean;
  resting: boolean;
  closed: boolean;
  size: bigint;
  escrow: bigint;
  settled: boolean;
  clearingTick: number;
  /** What has been paid out so far (Claimed + OrderCancelled events), or claimable now for open orders. */
  baseOut: bigint;
  quoteOut: bigint;
  cancelled: boolean;
}

/** Paid-out amounts of closed orders never change, so they're cached across renders. */
const payoutCache = new Map<Hex, { baseOut: bigint; quoteOut: bigint; cancelled: boolean }>();

async function payoutsOf(id: Hex, owner: Address, fromBlock: bigint, head: bigint) {
  let baseOut = 0n;
  let quoteOut = 0n;
  let cancelled = false;
  // The keeper pays taker orders within a block or two; scan one chunk from the order's batch.
  const toBlock = fromBlock + LOG_CHUNK - 1n < head ? fromBlock + LOG_CHUNK - 1n : head;
  const [claims, cancels] = await Promise.all([
    publicClient.getLogs({ address: deployment.address, event: claimedEvent, args: { orderId: id, owner }, fromBlock, toBlock }),
    publicClient.getLogs({ address: deployment.address, event: cancelledEvent, args: { orderId: id, owner }, fromBlock, toBlock }),
  ]);
  for (const l of claims) {
    baseOut += l.args.baseOut!;
    quoteOut += l.args.quoteOut!;
  }
  for (const l of cancels) {
    baseOut += l.args.baseOut!;
    quoteOut += l.args.quoteOut!;
    cancelled = true;
  }
  return { baseOut, quoteOut, cancelled };
}

export function usePortfolio(owner?: Address, limit = 30) {
  return useOnBlock(
    async (head) => {
      const a = owner!;
      const n = await publicClient.readContract({ ...m, functionName: "nonces", args: [a] });
      const nonces: bigint[] = [];
      for (let i = n - 1n; i >= 0n && nonces.length < limit; i--) nonces.push(i);
      return Promise.all(
        nonces.map(async (nonce): Promise<PortfolioOrder> => {
          const id = orderIdOf(a, nonce);
          const o = await publicClient.readContract({ ...m, functionName: "getOrder", args: [id] });
          const r = await publicClient.readContract({ ...m, functionName: "getBatchResult", args: [o.batchId] });
          let paid = payoutCache.get(id);
          if (!paid) {
            if (o.closed) {
              paid = await payoutsOf(id, a, o.batchId, head);
              payoutCache.set(id, paid);
            } else if (r.settled) {
              const [baseOut, quoteOut] = await publicClient.readContract({ ...m, functionName: "previewClaim", args: [id] });
              paid = { baseOut, quoteOut, cancelled: false };
            } else {
              paid = { baseOut: 0n, quoteOut: 0n, cancelled: false };
            }
          }
          return {
            id,
            nonce,
            batchId: BigInt(o.batchId),
            tick: o.tick,
            isBuy: o.isBuy,
            resting: o.resting,
            closed: o.closed,
            size: o.size,
            escrow: o.escrow,
            settled: r.settled,
            clearingTick: r.clearingTick,
            ...paid,
          };
        }),
      );
    },
    [owner, limit],
    !!owner,
  );
}
