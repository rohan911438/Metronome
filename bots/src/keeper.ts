/**
 * Keeper: settles each closed batch and pays everyone out, so users never have to press "claim".
 *
 * Every block it
 *   1. scans new OrderPlaced logs and remembers open taker orders (by batch) and open resting orders,
 *   2. if a closed batch is pending (or settled takers are still unclaimed), sends one settleAndClaim for them,
 *   3. every HARVEST_EVERY blocks, claims resting orders whose pool has filled since their last claim.
 * It only sends a transaction when there is work, and is stateless across restarts (it re-scans BACKFILL blocks).
 */
import type { Hex } from "viem";
import { metronomeAbi } from "./abi.js";
import { getOrder, isMain, log, onBlocks, scanOrders, send } from "./chain.js";
import { createCtx, keyFromEnv, walletFor, type Ctx, type Wallet } from "./config.js";

export interface KeeperOptions {
  maxClaimsPerTx?: number;
  harvestEvery?: bigint;
  backfill?: bigint;
}

export class Keeper {
  private takers = new Map<bigint, Set<Hex>>(); // open taker orders by batch
  private resting = new Set<Hex>(); // open resting orders
  private scannedTo = 0n;
  private lastHarvest = 0n;
  private stop?: () => void;
  readonly stats = { settleTxs: 0, claimed: 0, harvested: 0, errors: 0 };

  constructor(
    private ctx: Ctx,
    private wallet: Wallet,
    private opts: Required<KeeperOptions> = { maxClaimsPerTx: 40, harvestEvery: 20n, backfill: 2000n },
  ) {}

  async start() {
    const head = await this.ctx.public.getBlockNumber();
    const from = head > this.opts.backfill ? head - this.opts.backfill : 0n;
    this.scannedTo = from > this.ctx.deployment.deployBlock ? from - 1n : this.ctx.deployment.deployBlock - 1n;
    await this.scan(head);
    // Drop orders that were already closed before we started.
    await this.pruneClosed();
    log("keeper", `watching ${this.ctx.deployment.address} as ${this.wallet.account.address}`, this.summary());
    this.stop = onBlocks(this.ctx, (b) => this.onBlock(b));
  }

  shutdown() {
    this.stop?.();
  }

  summary() {
    let takers = 0;
    for (const s of this.takers.values()) takers += s.size;
    return { openTakers: takers, openResting: this.resting.size, ...this.stats };
  }

  private async onBlock(head: bigint) {
    await this.scan(head);
    try {
      await this.settleAndClaim(head);
      if (head - this.lastHarvest >= this.opts.harvestEvery) {
        this.lastHarvest = head;
        await this.harvest();
      }
    } catch (e) {
      this.stats.errors++;
      log("keeper", "error:", (e as Error).message.split("\n")[0]);
    }
  }

  private async scan(head: bigint) {
    if (head <= this.scannedTo) return;
    const orders = await scanOrders(this.ctx, this.scannedTo + 1n, head);
    const lab = this.ctx.deployment.sandwichLab?.toLowerCase();
    for (const o of orders) {
      if (o.owner.toLowerCase() === lab) continue; // the demo lab settles and claims its own orders
      if (o.resting) this.resting.add(o.orderId);
      else {
        if (!this.takers.has(o.batchId)) this.takers.set(o.batchId, new Set());
        this.takers.get(o.batchId)!.add(o.orderId);
      }
    }
    this.scannedTo = head;
  }

  private async settleAndClaim(head: bigint) {
    const target = head - 1n; // the newest closed batch
    const ids: Hex[] = [];
    for (const [batch, set] of [...this.takers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (batch > target) continue;
      for (const id of set) {
        if (ids.length >= this.opts.maxClaimsPerTx) break;
        ids.push(id);
      }
    }
    const pending = await this.ctx.public.readContract({
      address: this.ctx.deployment.address,
      abi: metronomeAbi,
      functionName: "nextPendingBatch",
    });
    const needsSettle = pending !== 0n && pending <= target;
    if (!needsSettle && ids.length === 0) return;

    const receipt = await send(this.ctx, this.wallet, {
      address: this.ctx.deployment.address,
      abi: metronomeAbi,
      functionName: "settleAndClaim",
      args: [target, ids],
    });
    this.stats.settleTxs++;
    this.stats.claimed += ids.length;
    for (const [batch, set] of this.takers) {
      for (const id of ids) set.delete(id);
      if (set.size === 0) this.takers.delete(batch);
    }
    log("keeper", `settled through ${target}, claimed ${ids.length}`, `gas ${receipt.gasUsed}`);
  }

  /** Claims resting orders that have something to collect, and forgets the ones that closed. */
  private async harvest() {
    if (this.resting.size === 0) return;
    const ids = [...this.resting];
    const previews = await Promise.all(
      ids.map((id) =>
        this.ctx.public.readContract({
          address: this.ctx.deployment.address,
          abi: metronomeAbi,
          functionName: "previewClaim",
          args: [id],
        }),
      ),
    );
    const due: Hex[] = [];
    previews.forEach(([base, quote, ready], i) => {
      if (ready && base + quote > 0n) due.push(ids[i]!);
    });
    for (let i = 0; i < due.length; i += this.opts.maxClaimsPerTx) {
      const chunk = due.slice(i, i + this.opts.maxClaimsPerTx);
      await send(this.ctx, this.wallet, {
        address: this.ctx.deployment.address,
        abi: metronomeAbi,
        functionName: "claimMany",
        args: [chunk],
      });
      this.stats.harvested += chunk.length;
      log("keeper", `harvested ${chunk.length} resting orders`);
    }
    await this.pruneClosed();
  }

  private async pruneClosed() {
    const all = [...this.resting, ...[...this.takers.values()].flatMap((s) => [...s])];
    const orders = await Promise.all(all.map((id) => getOrder(this.ctx, id)));
    all.forEach((id, i) => {
      if (!orders[i]!.closed) return;
      this.resting.delete(id);
      for (const [batch, set] of this.takers) {
        set.delete(id);
        if (set.size === 0) this.takers.delete(batch);
      }
    });
  }
}

// Run directly: NETWORK=testnet pnpm keeper
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const ctx = createCtx();
  const keeper = new Keeper(ctx, walletFor(ctx, keyFromEnv("KEEPER_PRIVATE_KEY")));
  await keeper.start();
  setInterval(() => log("keeper", keeper.summary()), 30_000);
}
