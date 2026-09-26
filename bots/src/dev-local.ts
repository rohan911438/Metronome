/**
 * Long-running local stack for frontend development:
 *   Anvil on :8545 (1 s blocks), full deploy, keeper, market maker, one sandwich-lab run, and two background traders
 *   that send random taker orders and nudge the MiniAMM price so the MM re-quotes. Runs until Ctrl-C.
 *
 *   pnpm dev:local        (then `pnpm web:dev` in another terminal)
 */
import { erc20Abi, maxUint256 } from "viem";
import { metronomeAbi, miniAmmAbi, sandwichLabAbi } from "./abi.js";
import { KEYS, sleep, startLocalStack } from "./anvil.js";
import { log, onBlocks, send, tickForPrice } from "./chain.js";
import { createCtx, walletFor } from "./config.js";
import { Keeper } from "./keeper.js";
import { MarketMaker, defaultMmOptions } from "./mm.js";

const PORT = Number(process.env.PORT ?? 8545);
const RPC = `http://127.0.0.1:${PORT}`;

async function main() {
  const anvil = await startLocalStack(PORT);
  const stopAll: (() => unknown)[] = [() => anvil.kill()];
  const shutdown = () => {
    for (const f of stopAll.reverse()) f();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const ctx = createCtx({ network: "local", rpcUrl: RPC });
  const { address: m, base, quote, miniAmm, sandwichLab } = ctx.deployment;
  log("dev", `Metronome ${m} on ${RPC}`);

  const keeper = new Keeper(ctx, walletFor(ctx, KEYS[1]!), { maxClaimsPerTx: 40, harvestEvery: 5n, backfill: 100n });
  const mm = new MarketMaker(ctx, walletFor(ctx, KEYS[2]!), { ...defaultMmOptions(), size: 20_000n * 10n ** 18n });
  await keeper.start();
  await mm.start();
  stopAll.push(() => keeper.shutdown(), () => mm.shutdown());

  const traders = [KEYS[3]!, KEYS[4]!].map((k) => walletFor(ctx, k));
  const labCaller = walletFor(ctx, KEYS[5]!);
  for (const w of [...traders, labCaller]) {
    for (const token of [base, quote]) {
      for (const spender of [m, miniAmm!, sandwichLab!]) {
        await send(ctx, w, { address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
      }
    }
  }

  // One sandwich run so /lab has a result to show from the start.
  const spot = await ctx.public.readContract({ address: miniAmm!, abi: miniAmmAbi, functionName: "spotPrice" });
  const victim = 100_000n * 10n ** 18n;
  await send(ctx, labCaller, {
    address: sandwichLab!,
    abi: sandwichLabAbi,
    functionName: "run",
    args: [victim, victim, tickForPrice(ctx.deployment.priceMin, spot)],
  });
  const runId = (await ctx.public.readContract({ address: sandwichLab!, abi: sandwichLabAbi, functionName: "runCount" })) - 1n;
  await sleep(1200);
  await send(ctx, labCaller, { address: sandwichLab!, abi: sandwichLabAbi, functionName: "finish", args: [runId] });
  log("dev", "sandwich lab run 0 recorded");

  // Background flow: taker orders every other block, a random AMM swap every ~15 blocks.
  let n = 0;
  stopAll.push(
    onBlocks(ctx, async (block) => {
      if (block % 2n !== 0n) return;
      n++;
      const ref = await mm.referenceTick();
      await Promise.all(
        traders.map(async (t) => {
          const isBuy = Math.random() < 0.5;
          const tick = ref + (isBuy ? 1 : -1) * Math.floor(Math.random() * 10);
          const size = BigInt(1 + Math.floor(Math.random() * 20)) * 10n ** 21n; // 1k-20k MON
          await send(ctx, t, { address: m, abi: metronomeAbi, functionName: "placeOrder", args: [isBuy, tick, size, false] });
        }),
      ).catch((e) => log("dev", "trader error:", (e as Error).message.split("\n")[0]));
      if (n % 8 === 0) {
        const t = traders[0]!;
        const amount = BigInt(20 + Math.floor(Math.random() * 60)) * 10n ** 21n; // 20k-80k MON
        const buy = Math.random() < 0.5;
        await send(ctx, t, {
          address: miniAmm!,
          abi: miniAmmAbi,
          functionName: buy ? "buyBase" : "sellBase",
          args: buy ? [amount, maxUint256, t.account.address] : [amount, 0n, t.account.address],
        }).catch((e) => log("dev", "amm error:", (e as Error).message.split("\n")[0]));
      }
    }),
  );

  log("dev", "running: keeper, market maker, 2 background traders. Ctrl-C to stop.");
  setInterval(() => log("dev", { keeper: keeper.summary(), mm: mm.stats }), 30_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
