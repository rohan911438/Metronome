import { pathToFileURL } from "node:url";
import { type Abi, type ContractFunctionArgs, type ContractFunctionName, type Hex, parseAbiItem } from "viem";
import type { Ctx, Wallet } from "./config.js";
import { metronomeAbi } from "./abi.js";

export const log = (tag: string, ...args: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 23), `[${tag}]`, ...args);

/**
 * Sends a contract call with a tight gas limit. Monad charges for the gas *limit*, not gas used, so a padded default
 * would waste money: estimate, add 20%, send, and wait for the receipt.
 */
export async function send<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(
  ctx: Ctx,
  wallet: Wallet,
  call: {
    address: Hex;
    abi: abi;
    functionName: name;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>;
  },
) {
  const params = { ...call, account: wallet.account } as never;
  const gas = await ctx.public.estimateContractGas(params);
  const hash = await wallet.writeContract({ ...(params as object), gas: (gas * 12n) / 10n } as never);
  const receipt = await ctx.public.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${String(call.functionName)} reverted: ${hash}`);
  return receipt;
}

export const orderPlacedEvent = parseAbiItem(
  "event OrderPlaced(bytes32 indexed orderId, address indexed owner, uint256 indexed batchId, bool isBuy, bool resting, uint16 tick, uint128 size, uint128 escrow, uint256 shard)",
);

export interface PlacedOrder {
  orderId: Hex;
  owner: Hex;
  batchId: bigint;
  isBuy: boolean;
  resting: boolean;
  tick: number;
  size: bigint;
}

/** OrderPlaced logs in [from, to], fetched in chunks small enough for public RPC limits. */
export async function scanOrders(ctx: Ctx, from: bigint, to: bigint, owner?: Hex): Promise<PlacedOrder[]> {
  const out: PlacedOrder[] = [];
  for (let start = from; start <= to; start += ctx.logChunk) {
    const end = start + ctx.logChunk - 1n < to ? start + ctx.logChunk - 1n : to;
    const logs = await ctx.public.getLogs({
      address: ctx.deployment.address,
      event: orderPlacedEvent,
      args: owner ? { owner } : undefined,
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      const a = l.args;
      out.push({
        orderId: a.orderId!,
        owner: a.owner!,
        batchId: a.batchId!,
        isBuy: a.isBuy!,
        resting: a.resting!,
        tick: a.tick!,
        size: a.size!,
      });
    }
  }
  return out;
}

export async function getOrder(ctx: Ctx, orderId: Hex) {
  return ctx.public.readContract({
    address: ctx.deployment.address,
    abi: metronomeAbi,
    functionName: "getOrder",
    args: [orderId],
  });
}

/** Calls `fn` for every new block number, one at a time (a slow handler never overlaps itself). */
export function onBlocks(ctx: Ctx, fn: (block: bigint) => Promise<void>): () => void {
  let stopped = false;
  let last = 0n;
  const loop = async () => {
    while (!stopped) {
      try {
        const block = await ctx.public.getBlockNumber({ cacheTime: 0 });
        if (block > last) {
          last = block;
          await fn(block);
        }
      } catch (e) {
        log("blocks", "error:", (e as Error).message.split("\n")[0]);
      }
      await new Promise((r) => setTimeout(r, ctx.pollMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

/** Tick whose price is closest to `price` (same units as Metronome.price: raw quote per raw base, scaled 1e36). */
export function tickForPrice(priceMin: bigint, price: bigint): number {
  const t = Math.round(Math.log(Number(price) / Number(priceMin)) / Math.log(1.001));
  return Math.min(4095, Math.max(0, t));
}

/** True when this module is the entry point (`tsx src/keeper.ts`), not an import. */
export const isMain = (metaUrl: string) =>
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === metaUrl;
