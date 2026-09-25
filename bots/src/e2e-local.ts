/**
 * End-to-end run on a local Anvil chain:
 *   1. start Anvil (1 s blocks) and deploy the full stack with contracts/script/DeployLocal.s.sol
 *   2. start the keeper (account 1) and the market maker (account 2)
 *   3. three traders (accounts 3-5) send random taker orders for TRADE_BLOCKS blocks
 *   4. run the sandwich lab once
 *   5. check: takers got fills, every closed batch settled, every taker order paid out, the MM is still quoting
 *
 *   pnpm e2e:local
 */
import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { erc20Abi, maxUint256, parseAbiItem, type Hex } from "viem";
import { metronomeAbi, sandwichLabAbi, miniAmmAbi } from "./abi.js";
import { log, send, tickForPrice } from "./chain.js";
import { createCtx, walletFor, type Ctx } from "./config.js";
import { Keeper } from "./keeper.js";
import { MarketMaker, defaultMmOptions } from "./mm.js";

const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const TRADE_BLOCKS = Number(process.env.TRADE_BLOCKS ?? 20);
// Anvil's default accounts 0-5 (mnemonic "test test ... junk"); test-only keys.
const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts");
const claimedEvent = parseAbiItem(
  "event Claimed(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut, bool closed)",
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (msg: string): never => {
  throw new Error(`E2E FAILED: ${msg}`);
};

async function waitForBlocks(ctx: Ctx, n: number) {
  const target = (await ctx.public.getBlockNumber()) + BigInt(n);
  while ((await ctx.public.getBlockNumber()) < target) await sleep(200);
}

async function main() {
  // 1. Chain + contracts
  const anvil = spawn("anvil", ["--port", String(PORT), "--block-time", "1", "--silent"], { stdio: "ignore" });
  try {
    await sleep(1500);
    execFileSync(
      "forge",
      ["script", "script/DeployLocal.s.sol", "--rpc-url", RPC, "--broadcast", "--private-key", KEYS[0]!],
      { cwd: contractsDir, stdio: "ignore" },
    );
    const ctx = createCtx({ network: "local", rpcUrl: RPC });
    const m = ctx.deployment.address;
    log("e2e", `deployed Metronome ${m} (${ctx.deployment.shards} shards)`);

    // 2. Bots
    const keeper = new Keeper(ctx, walletFor(ctx, KEYS[1]!), { maxClaimsPerTx: 40, harvestEvery: 5n, backfill: 100n });
    const mm = new MarketMaker(ctx, walletFor(ctx, KEYS[2]!), { ...defaultMmOptions(), size: 20_000n * 10n ** 18n });
    await keeper.start();
    await mm.start();
    await waitForBlocks(ctx, 3);
    if (mm.openQuotes.length === 0) fail("market maker posted no quotes");

    // 3. Traders: every block, each sends one random taker order near the reference price.
    const traders = KEYS.slice(3).map((k) => walletFor(ctx, k));
    for (const t of traders) {
      for (const token of [ctx.deployment.base, ctx.deployment.quote]) {
        await send(ctx, t, { address: token, abi: erc20Abi, functionName: "approve", args: [m, maxUint256] });
      }
    }
    const taken: Hex[] = [];
    const startBlock = await ctx.public.getBlockNumber();
    let lastBlock = startBlock;
    while (lastBlock < startBlock + BigInt(TRADE_BLOCKS)) {
      const block = await ctx.public.getBlockNumber();
      if (block === lastBlock) {
        await sleep(150);
        continue;
      }
      lastBlock = block;
      const ref = await mm.referenceTick();
      await Promise.all(
        traders.map(async (t) => {
          const isBuy = Math.random() < 0.5;
          const tick = ref + (isBuy ? 1 : -1) * Math.floor(Math.random() * 12); // crosses the MM's inner levels
          const size = BigInt(1 + Math.floor(Math.random() * 30)) * 10n ** 21n; // 1k-30k MON
          const r = await send(ctx, t, { address: m, abi: metronomeAbi, functionName: "placeOrder", args: [isBuy, tick, size, false] });
          taken.push(r.logs.find((l) => l.address.toLowerCase() === m.toLowerCase())!.topics[1]!);
        }),
      );
    }
    log("e2e", `placed ${taken.length} taker orders over ${TRADE_BLOCKS} blocks`);

    // 4. Sandwich lab: one run, settled by the lab itself.
    const lab = ctx.deployment.sandwichLab!;
    const labCaller = traders[0]!;
    for (const token of [ctx.deployment.base, ctx.deployment.quote]) {
      await send(ctx, labCaller, { address: token, abi: erc20Abi, functionName: "approve", args: [lab, maxUint256] });
    }
    const spot = await ctx.public.readContract({ address: ctx.deployment.miniAmm!, abi: miniAmmAbi, functionName: "spotPrice" });
    const makerTick = tickForPrice(ctx.deployment.priceMin, spot);
    const victim = 100_000n * 10n ** 18n;
    const runRcpt = await send(ctx, labCaller, { address: lab, abi: sandwichLabAbi, functionName: "run", args: [victim, victim, makerTick] });
    const runId = (await ctx.public.readContract({ address: lab, abi: sandwichLabAbi, functionName: "runCount" })) - 1n;
    await waitForBlocks(ctx, 1);
    const finRcpt = await send(ctx, labCaller, { address: lab, abi: sandwichLabAbi, functionName: "finish", args: [runId] });
    const ammEv = (await ctx.public.getContractEvents({ address: lab, abi: sandwichLabAbi, eventName: "AmmSandwich", fromBlock: runRcpt.blockNumber, toBlock: runRcpt.blockNumber }))[0]!.args;
    const metEv = (await ctx.public.getContractEvents({ address: lab, abi: sandwichLabAbi, eventName: "MetronomeSandwich", fromBlock: finRcpt.blockNumber, toBlock: finRcpt.blockNumber }))[0]!.args;
    const bps = (a: bigint, b: bigint) => (Number(a - b) * 10_000) / Number(b);
    log("e2e", `sandwich on AMM:       victim overpaid ${bps(ammEv.attackedCost!, ammEv.cleanCost!).toFixed(1)} bps, attacker P&L ${Number(ammEv.attackerPnl!) / 1e6} AUSD`);
    log("e2e", `sandwich on Metronome: victim overpaid ${bps(metEv.attackedCost!, metEv.cleanCost!).toFixed(1)} bps, attacker P&L ${Number(metEv.attackerPnl!) / 1e6} AUSD`);
    if (metEv.attackedCost! > metEv.cleanCost!) fail("Metronome victim overpaid");
    if (metEv.attackerPnl! > 0n) fail("Metronome attacker profited");

    // 5. Let the keeper catch up, then check.
    await waitForBlocks(ctx, 4);
    const head = await ctx.public.getBlockNumber();
    const pending = await ctx.public.readContract({ address: m, abi: metronomeAbi, functionName: "nextPendingBatch" });
    if (pending !== 0n && pending < head - 1n) fail(`batch ${pending} still pending at block ${head}`);

    const orders = await Promise.all(taken.map((id) => ctx.public.readContract({ address: m, abi: metronomeAbi, functionName: "getOrder", args: [id] })));
    const unpaid = orders.filter((o) => !o.closed).length;
    if (unpaid > 0) fail(`${unpaid} taker orders not paid out by the keeper`);

    const claims = await ctx.public.getLogs({ address: m, event: claimedEvent, fromBlock: startBlock, toBlock: head });
    const takenSet = new Set(taken);
    let filled = 0;
    for (const c of claims) {
      if (!takenSet.has(c.args.orderId!)) continue;
      const o = orders[taken.indexOf(c.args.orderId!)]!;
      if (o.isBuy ? c.args.baseOut! > 0n : c.args.quoteOut! > 0n) filled++;
    }
    if (filled === 0) fail("no taker order was filled");
    if (mm.openQuotes.length === 0) fail("market maker stopped quoting");

    log("e2e", "PASS", { takerOrders: taken.length, filled, keeper: keeper.summary(), mm: mm.stats });
    keeper.shutdown();
    await mm.shutdown();
  } finally {
    anvil.kill();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
