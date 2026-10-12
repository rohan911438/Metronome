/**
 * `pnpm smoke`: end-to-end check of a deployed market without a counterparty, so it runs on a fresh mainnet market.
 * Wraps MON, places a taker sell (no bids → refunded), settles its batch itself, claims the refund, then posts and
 * cancels a resting ask. Every step asserts the on-chain result.
 *
 * Uses SMOKE_PRIVATE_KEY (falls back to PRIVATE_KEY). NETWORK selects the market as for the other bots.
 */
import { erc20Abi, formatEther, maxUint256, parseEventLogs, type Hex } from "viem";
import { metronomeAbi } from "./abi.js";
import { sleep } from "./anvil.js";
import { isMain, log, send } from "./chain.js";
import { createCtx, walletFor } from "./config.js";

const wmonAbi = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;

function check(cond: boolean, what: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${what}`);
  log("smoke", `ok   ${what}`);
}

async function main() {
  const key = (process.env.SMOKE_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as Hex | undefined;
  if (!key) throw new Error("set SMOKE_PRIVATE_KEY (or PRIVATE_KEY)");
  const ctx = createCtx();
  const w = walletFor(ctx, key);
  const d = ctx.deployment;
  const me = w.account.address;
  const m = { address: d.address, abi: metronomeAbi } as const;
  const size = d.minOrderSize;
  const wmonOf = () => ctx.public.readContract({ address: d.base, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  log("smoke", `${me} on ${ctx.network}, market ${d.address}, ${formatEther(await ctx.public.getBalance({ address: me }))} MON`);

  // 1. Wrap and approve.
  if ((await wmonOf()) < 2n * size) {
    const hash = await w.writeContract({ address: d.base, abi: wmonAbi, functionName: "deposit", value: 2n * size - (await wmonOf()) });
    check((await ctx.public.waitForTransactionReceipt({ hash })).status === "success", `wrapped MON (${hash})`);
  }
  const allowance = await ctx.public.readContract({ address: d.base, abi: erc20Abi, functionName: "allowance", args: [me, d.address] });
  if (allowance < maxUint256 / 2n) await send(ctx, w, { address: d.base, abi: erc20Abi, functionName: "approve", args: [d.address, maxUint256] });
  const before = await wmonOf();

  // 2. Taker sell with nobody to trade against: settles empty-sided and refunds in full.
  const [ticks, buys] = await ctx.public.readContract({ ...m, functionName: "getRestingBook" });
  const bidTicks = ticks.filter((_, j) => buys[j]! > 0n);
  const sellTick = bidTicks.length ? Math.max(...bidTicks) + 1 : 2048; // above every bid, so it cannot cross
  const placed = await send(ctx, w, { ...m, functionName: "placeOrder", args: [false, sellTick, size, false] });
  const [ev] = parseEventLogs({ abi: metronomeAbi, eventName: "OrderPlaced", logs: placed.logs });
  check(!!ev && ev.args.escrow === size, `taker sell placed at tick ${sellTick}, batch ${placed.blockNumber} (${placed.transactionHash})`);
  check((await wmonOf()) === before - size, "sell escrowed 1 WMON");

  while ((await ctx.public.getBlockNumber()) <= placed.blockNumber) await sleep(ctx.pollMs);
  let res = await ctx.public.readContract({ ...m, functionName: "getBatchResult", args: [placed.blockNumber] });
  if (!res.settled) {
    const s = await send(ctx, w, { ...m, functionName: "settle", args: [placed.blockNumber] });
    log("smoke", `     settled batch ${placed.blockNumber} (${s.transactionHash}, ${s.gasUsed} gas)`);
    res = await ctx.public.readContract({ ...m, functionName: "getBatchResult", args: [placed.blockNumber] });
  }
  check(res.settled && res.volume === 0n, "batch settled with no volume");
  const o = await ctx.public.readContract({ ...m, functionName: "getOrder", args: [ev.args.orderId] });
  if (!o.closed) {
    const c = await send(ctx, w, { ...m, functionName: "claim", args: [ev.args.orderId] });
    log("smoke", `     claimed (${c.transactionHash})`);
  }
  check((await wmonOf()) === before, "full WMON refund after claim");

  // 3. Resting ask: post, then cancel for a full refund.
  const askTick = sellTick + 20;
  const rp = await send(ctx, w, { ...m, functionName: "placeOrder", args: [false, askTick, size, true] });
  const [rev] = parseEventLogs({ abi: metronomeAbi, eventName: "OrderPlaced", logs: rp.logs });
  check(!!rev && rev.args.resting, `resting ask posted at tick ${askTick} (${rp.transactionHash})`);
  // It joins its pool when its batch settles.
  while ((await ctx.public.getBlockNumber()) <= rp.blockNumber) await sleep(ctx.pollMs);
  if (!(await ctx.public.readContract({ ...m, functionName: "getBatchResult", args: [rp.blockNumber] })).settled)
    await send(ctx, w, { ...m, functionName: "settle", args: [rp.blockNumber] });
  const pool = await ctx.public.readContract({ ...m, functionName: "getPool", args: [false, askTick] });
  check(pool.remaining >= size, "ask joined its pool at settle");
  const cx = await send(ctx, w, { ...m, functionName: "cancel", args: [rev.args.orderId] });
  check((await wmonOf()) === before, `resting ask cancelled and refunded (${cx.transactionHash})`);

  log("smoke", `PASS. ${formatEther(await ctx.public.getBalance({ address: me }))} MON left`);
}

if (isMain(import.meta.url)) await main();
