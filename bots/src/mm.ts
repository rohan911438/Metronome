/**
 * Market maker: keeps a ladder of resting orders around a reference price.
 *
 * Resting orders stay in every batch until filled, so the bot only sends transactions when the reference price moves
 * by REQUOTE_TICKS or more (cancel the old ladder, post a new one). It also collects its own fills every few blocks.
 *
 * Reference price, first available of: the MiniAMM spot price (local demo), the last clearing price, START_TICK.
 */
import { erc20Abi, maxUint256, type Hex } from "viem";
import { metronomeAbi, miniAmmAbi } from "./abi.js";
import { isMain, log, onBlocks, send, tickForPrice } from "./chain.js";
import { createCtx, keyFromEnv, walletFor, type Ctx, type Wallet } from "./config.js";

export interface MmOptions {
  levels: number; // orders per side
  firstTicks: number; // distance of the best bid/ask from the reference, in ticks (1 tick = 10 bps)
  stepTicks: number; // distance between levels
  size: bigint; // base units per order
  requoteTicks: number; // re-quote when the reference moves this far
  startTick: number; // fallback reference
  claimEvery: bigint; // blocks between collecting own fills
}

export const defaultMmOptions = (): MmOptions => ({
  levels: Number(process.env.MM_LEVELS ?? 5),
  firstTicks: Number(process.env.MM_FIRST_TICKS ?? 2),
  stepTicks: Number(process.env.MM_STEP_TICKS ?? 2),
  size: BigInt(process.env.MM_SIZE ?? 50n * 10n ** 18n),
  requoteTicks: Number(process.env.MM_REQUOTE_TICKS ?? 3),
  startTick: Number(process.env.START_TICK ?? 2048),
  claimEvery: BigInt(process.env.MM_CLAIM_EVERY ?? 10),
});

interface Quote {
  id: Hex;
  isBuy: boolean;
  tick: number;
}

export class MarketMaker {
  private quotes: Quote[] = [];
  private quotedRef?: number;
  private lastClaim = 0n;
  private stop?: () => void;
  readonly stats = { requotes: 0, posted: 0, cancelled: 0, claims: 0, errors: 0 };

  constructor(
    private ctx: Ctx,
    private wallet: Wallet,
    private opts: MmOptions = defaultMmOptions(),
  ) {}

  async start() {
    const m = this.ctx.deployment.address;
    for (const token of [this.ctx.deployment.base, this.ctx.deployment.quote]) {
      const allowance = await this.ctx.public.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.wallet.account.address, m],
      });
      if (allowance < maxUint256 / 2n) {
        await send(this.ctx, this.wallet, { address: token, abi: erc20Abi, functionName: "approve", args: [m, maxUint256] });
      }
    }
    log("mm", `quoting on ${m} as ${this.wallet.account.address}`, this.opts);
    this.stop = onBlocks(this.ctx, (b) => this.onBlock(b));
  }

  /** Stops quoting. With `cancel`, also pulls every open quote. */
  async shutdown(cancel = false) {
    this.stop?.();
    if (cancel) await this.cancelAll();
  }

  get openQuotes(): readonly Quote[] {
    return this.quotes;
  }

  private async onBlock(block: bigint) {
    try {
      const ref = await this.referenceTick();
      if (this.quotedRef === undefined || Math.abs(ref - this.quotedRef) >= this.opts.requoteTicks) {
        await this.requote(ref);
      }
      if (block - this.lastClaim >= this.opts.claimEvery) {
        this.lastClaim = block;
        await this.collect();
      }
    } catch (e) {
      this.stats.errors++;
      log("mm", "error:", (e as Error).message.split("\n")[0]);
    }
  }

  async referenceTick(): Promise<number> {
    const { miniAmm, priceMin, address } = this.ctx.deployment;
    if (miniAmm) {
      const spot = await this.ctx.public.readContract({ address: miniAmm, abi: miniAmmAbi, functionName: "spotPrice" });
      return tickForPrice(priceMin, spot);
    }
    const last = await this.ctx.public.readContract({ address, abi: metronomeAbi, functionName: "lastClearingTick" });
    return last > 0 ? last : this.opts.startTick;
  }

  private async requote(ref: number) {
    await this.cancelAll();
    const [baseBal, quoteBal] = await Promise.all([
      this.balance(this.ctx.deployment.base),
      this.balance(this.ctx.deployment.quote),
    ]);
    let baseLeft = baseBal;
    let quoteLeft = quoteBal;
    const m = this.ctx.deployment.address;

    // Decide the whole ladder first, then send it in parallel (nonces are managed locally).
    const ladder: { isBuy: boolean; tick: number }[] = [];
    for (let i = 0; i < this.opts.levels; i++) {
      const offset = this.opts.firstTicks + i * this.opts.stepTicks;
      const bidTick = ref - offset;
      const askTick = ref + offset;
      if (bidTick >= 0) {
        const cost = await this.ctx.public.readContract({
          address: m,
          abi: metronomeAbi,
          functionName: "restingBuyEscrow",
          args: [this.opts.size, BigInt(bidTick)],
        });
        if (cost <= quoteLeft) {
          quoteLeft -= cost;
          ladder.push({ isBuy: true, tick: bidTick });
        }
      }
      if (askTick <= 4095 && this.opts.size <= baseLeft) {
        baseLeft -= this.opts.size;
        ladder.push({ isBuy: false, tick: askTick });
      }
    }
    await Promise.all(ladder.map((q) => this.post(q.isBuy, q.tick)));
    this.quotedRef = ref;
    this.stats.requotes++;
    log("mm", `quoted around tick ${ref}: ${this.quotes.length} orders`);
  }

  private async post(isBuy: boolean, tick: number) {
    const receipt = await send(this.ctx, this.wallet, {
      address: this.ctx.deployment.address,
      abi: metronomeAbi,
      functionName: "placeOrder",
      args: [isBuy, tick, this.opts.size, true],
    });
    const placed = receipt.logs.find((l) => l.address.toLowerCase() === this.ctx.deployment.address.toLowerCase());
    const id = placed?.topics[1];
    if (!id) throw new Error("OrderPlaced log missing");
    this.quotes.push({ id, isBuy, tick });
    this.stats.posted++;
  }

  private async cancelAll() {
    const orders = await Promise.all(
      this.quotes.map((q) =>
        this.ctx.public.readContract({
          address: this.ctx.deployment.address,
          abi: metronomeAbi,
          functionName: "getOrder",
          args: [q.id],
        }),
      ),
    );
    const open = this.quotes.filter((_, i) => !orders[i]!.closed); // skip ones fully filled and collected
    await Promise.all(
      open.map((q) =>
        send(this.ctx, this.wallet, {
          address: this.ctx.deployment.address,
          abi: metronomeAbi,
          functionName: "cancel",
          args: [q.id],
        }),
      ),
    );
    this.stats.cancelled += open.length;
    this.quotes = [];
  }

  /** Collects fills on open quotes, only if there is something to collect (the keeper may have done it already). */
  private async collect() {
    const previews = await Promise.all(
      this.quotes.map((q) =>
        this.ctx.public.readContract({
          address: this.ctx.deployment.address,
          abi: metronomeAbi,
          functionName: "previewClaim",
          args: [q.id],
        }),
      ),
    );
    const due = this.quotes.filter((_, i) => {
      const [base, quote, ready] = previews[i]!;
      return ready && base + quote > 0n;
    });
    if (due.length === 0) return;
    await send(this.ctx, this.wallet, {
      address: this.ctx.deployment.address,
      abi: metronomeAbi,
      functionName: "claimMany",
      args: [due.map((q) => q.id)],
    });
    this.stats.claims++;
  }

  private balance(token: Hex) {
    return this.ctx.public.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.wallet.account.address],
    });
  }
}

// Run directly: NETWORK=testnet pnpm mm
if (isMain(import.meta.url)) {
  const ctx = createCtx();
  const mm = new MarketMaker(ctx, walletFor(ctx, keyFromEnv("MM_PRIVATE_KEY")));
  await mm.start();
  process.on("SIGINT", async () => {
    log("mm", "cancelling quotes before exit…");
    await mm.shutdown(true);
    process.exit(0);
  });
}
