/**
 * `pnpm taker [count] [sizeMON]`: sends a few real taker orders against the resting book, alternating buy and sell,
 * and waits for each to be settled and claimed by the keeper. For showing a live market on testnet.
 *
 * Uses TAKER_PRIVATE_KEY (bots/.env) and never falls back to the deployer, so fills are between two different
 * wallets. Buys cross at the best resting ask and sells at the best resting bid.
 */
import { erc20Abi, maxUint256, type Hex } from "viem";
import { metronomeAbi } from "./abi.js";
import { sleep } from "./anvil.js";
import { isMain, log, send } from "./chain.js";
import { createCtx, walletFor } from "./config.js";

const wmonAbi = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;

async function main() {
  const key = process.env.TAKER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("set TAKER_PRIVATE_KEY in bots/.env (a wallet other than the market maker)");
  const count = Number(process.argv[2] ?? 4);
  const size = BigInt(Math.round(Number(process.argv[3] ?? 1) * 1000)) * 10n ** 15n;

  const ctx = createCtx();
  const w = walletFor(ctx, key);
  const d = ctx.deployment;
  const me = w.account.address;
  log("taker", `${me} on ${ctx.network}: ${count} orders of ${Number(size) / 1e18} MON`);

  for (const token of [d.base, d.quote]) {
    const a = await ctx.public.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, d.address] });
    if (a < maxUint256 / 2n) await send(ctx, w, { address: token, abi: erc20Abi, functionName: "approve", args: [d.address, maxUint256] });
  }

  for (let i = 0; i < count; i++) {
    const isBuy = i % 2 === 0;
    const [ticks, buys, sells] = await ctx.public.readContract({ address: d.address, abi: metronomeAbi, functionName: "getRestingBook" });
    const asks = ticks.filter((_, j) => sells[j]! > 0n);
    const bids = ticks.filter((_, j) => buys[j]! > 0n);
    const tick = isBuy ? Math.min(...asks) : Math.max(...bids);
    if (!Number.isFinite(tick)) {
      log("taker", `no resting ${isBuy ? "asks" : "bids"} to trade against; skipping`);
      continue;
    }

    if (!isBuy) {
      const wmon = await ctx.public.readContract({ address: d.base, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      if (wmon < size) {
        const hash = await w.writeContract({ address: d.base, abi: wmonAbi, functionName: "deposit", value: size - wmon });
        await ctx.public.waitForTransactionReceipt({ hash });
      }
    }

    const r = await send(ctx, w, { address: d.address, abi: metronomeAbi, functionName: "placeOrder", args: [isBuy, tick, size, false] });
    log("taker", `${isBuy ? "buy" : "sell"} ${Number(size) / 1e18} MON at tick ${tick}: ${r.transactionHash} (block ${r.blockNumber})`);

    // Wait for the keeper to settle the batch and claim the order.
    for (let t = 0; t < 150; t++) {
      const res = await ctx.public.readContract({ address: d.address, abi: metronomeAbi, functionName: "getBatchResult", args: [r.blockNumber] });
      if (res.settled) {
        log("taker", `  settled: clearing tick ${res.clearingTick}, batch volume ${Number(res.volume) / 1e18} MON`);
        break;
      }
      await sleep(ctx.pollMs);
    }
  }
}

if (isMain(import.meta.url)) await main();
