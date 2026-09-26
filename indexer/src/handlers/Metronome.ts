/**
 * Metronome event handlers. Every handler updates the entity it's about plus the global and daily totals.
 *
 * HyperIndex runs each handler twice (a preload pass, then the real one), so handlers only read and write through
 * `context` and have no other side effects.
 */
import { indexer, type Batch, type DailyStats, type EvmOnEventContext, type Order, type Stats, type Trader } from "envio";

const PRICE_SCALE = 10n ** 36n;
const GLOBAL = "global";

type Ctx = EvmOnEventContext;

const emptyStats = (): Stats => ({
  id: GLOBAL,
  orders: 0,
  takerOrders: 0,
  restingOrders: 0,
  traders: 0,
  batchesSettled: 0,
  batchesWithTrades: 0,
  voidedBatches: 0,
  volumeBase: 0n,
  volumeQuote: 0n,
  claims: 0,
  cancels: 0,
  keeperRewards: 0n,
  settleDelayBlocksSum: 0n,
  settleDelaySamples: 0,
  gasPlaceSum: 0n,
  gasPlaceTxs: 0,
  gasSettleSum: 0n,
  gasSettleTxs: 0,
  gasClaimSum: 0n,
  gasClaimTxs: 0,
  gasCancelSum: 0n,
  gasCancelTxs: 0,
  lastBlock: 0,
  lastTimestamp: 0,
});

const dayOf = (timestamp: number) => {
  const dayStart = timestamp - (timestamp % 86400);
  return { id: new Date(dayStart * 1000).toISOString().slice(0, 10), dayStart };
};

async function stats(context: Ctx, block: { number: number; timestamp: number }): Promise<Stats> {
  const s = (await context.Stats.get(GLOBAL)) ?? emptyStats();
  return { ...s, lastBlock: Math.max(s.lastBlock, block.number), lastTimestamp: Math.max(s.lastTimestamp, block.timestamp) };
}

async function daily(context: Ctx, timestamp: number): Promise<DailyStats> {
  const { id, dayStart } = dayOf(timestamp);
  return (
    (await context.DailyStats.get(id)) ?? { id, dayStart, orders: 0, newTraders: 0, batchesWithTrades: 0, volumeBase: 0n, volumeQuote: 0n }
  );
}

async function batch(context: Ctx, id: bigint): Promise<Batch> {
  return (
    (await context.Batch.get(id)) ?? {
      id,
      orders: 0,
      settled: false,
      clearingTick: 0,
      price: 0n,
      volume: 0n,
      volumeQuote: 0n,
      rationed: 0,
      fillNum: 0n,
      fillDen: 0n,
      voided: false,
      settledBlock: undefined,
      settledAt: undefined,
      settleTx: undefined,
      settler: undefined,
      reward: 0n,
    }
  );
}

type GasKind = "place" | "settle" | "claim" | "cancel";

/** Adds the transaction's gas to the totals once, under the kind of the first Metronome event seen in it. */
async function countGas(context: Ctx, s: Stats, tx: { hash: string; gasUsed: bigint }, kind: GasKind): Promise<Stats> {
  if (await context.GasTx.get(tx.hash)) return s;
  context.GasTx.set({ id: tx.hash, kind, gasUsed: tx.gasUsed });
  switch (kind) {
    case "place":
      return { ...s, gasPlaceSum: s.gasPlaceSum + tx.gasUsed, gasPlaceTxs: s.gasPlaceTxs + 1 };
    case "settle":
      return { ...s, gasSettleSum: s.gasSettleSum + tx.gasUsed, gasSettleTxs: s.gasSettleTxs + 1 };
    case "claim":
      return { ...s, gasClaimSum: s.gasClaimSum + tx.gasUsed, gasClaimTxs: s.gasClaimTxs + 1 };
    case "cancel":
      return { ...s, gasCancelSum: s.gasCancelSum + tx.gasUsed, gasCancelTxs: s.gasCancelTxs + 1 };
  }
}

const TX_FIELDS = { transaction: ["hash", "gasUsed"], block: ["timestamp"] } as const;

indexer.onEvent({ contract: "Metronome", event: "OrderPlaced", fields: TX_FIELDS }, async ({ event, context }) => {
  const p = event.params;
  const block = { number: event.block.number, timestamp: event.block.timestamp };
  const owner = p.owner.toLowerCase();
  let s = await stats(context, block);
  const d = await daily(context, block.timestamp);

  const existing = await context.Trader.get(owner);
  const trader: Trader = existing
    ? { ...existing, orders: existing.orders + 1, restingOrders: existing.restingOrders + (p.resting ? 1 : 0), lastBlock: block.number }
    : {
        id: owner,
        orders: 1,
        restingOrders: p.resting ? 1 : 0,
        baseReceived: 0n,
        quoteReceived: 0n,
        firstBlock: block.number,
        lastBlock: block.number,
      };
  context.Trader.set(trader);

  const order: Order = {
    id: p.orderId,
    trader_id: owner,
    batchId: p.batchId,
    isBuy: p.isBuy,
    resting: p.resting,
    tick: Number(p.tick),
    size: p.size,
    escrow: p.escrow,
    shard: Number(p.shard),
    placedBlock: block.number,
    placedAt: block.timestamp,
    placedTx: event.transaction.hash,
    status: "open",
    claims: 0,
    baseOut: 0n,
    quoteOut: 0n,
    closedBlock: undefined,
  };
  context.Order.set(order);

  const b = await batch(context, p.batchId);
  context.Batch.set({ ...b, orders: b.orders + 1 });

  s = {
    ...s,
    orders: s.orders + 1,
    takerOrders: s.takerOrders + (p.resting ? 0 : 1),
    restingOrders: s.restingOrders + (p.resting ? 1 : 0),
    traders: s.traders + (existing ? 0 : 1),
  };
  context.Stats.set(await countGas(context, s, event.transaction, "place"));
  context.DailyStats.set({ ...d, orders: d.orders + 1, newTraders: d.newTraders + (existing ? 0 : 1) });
});

const SETTLE_FIELDS = { transaction: ["hash", "gasUsed", "from"], block: ["timestamp"] } as const;

indexer.onEvent({ contract: "Metronome", event: "BatchSettled", fields: SETTLE_FIELDS }, async ({ event, context }) => {
  const p = event.params;
  // The keeper is whoever sent the settle transaction (a bot, a CRE workflow, or a trader settling their own batch).
  const settler = (event.transaction.from ?? "").toLowerCase();
  const block = { number: event.block.number, timestamp: event.block.timestamp };
  let s = await stats(context, block);
  const b = await batch(context, p.batchId);
  const volumeQuote = (p.volume * p.price) / PRICE_SCALE;

  context.Batch.set({
    ...b,
    settled: true,
    clearingTick: Number(p.clearingTick),
    price: p.price,
    volume: p.volume,
    volumeQuote,
    rationed: Number(p.rationed),
    fillNum: p.fillNum,
    fillDen: p.fillDen,
    voided: p.voided,
    settledBlock: block.number,
    settledAt: block.timestamp,
    settleTx: event.transaction.hash,
    settler: settler || b.settler,
  });

  if (settler) {
    const k = (await context.Keeper.get(settler)) ?? { id: settler, batchesSettled: 0, rewards: 0n, lastBlock: 0 };
    context.Keeper.set({ ...k, batchesSettled: k.batchesSettled + 1, lastBlock: block.number });
  }

  const traded = p.volume > 0n && !p.voided;
  s = {
    ...s,
    batchesSettled: s.batchesSettled + 1,
    batchesWithTrades: s.batchesWithTrades + (traded ? 1 : 0),
    voidedBatches: s.voidedBatches + (p.voided ? 1 : 0),
    volumeBase: s.volumeBase + (traded ? p.volume : 0n),
    volumeQuote: s.volumeQuote + (traded ? volumeQuote : 0n),
    ...(b.orders > 0
      ? { settleDelayBlocksSum: s.settleDelayBlocksSum + (BigInt(block.number) - p.batchId), settleDelaySamples: s.settleDelaySamples + 1 }
      : {}),
  };
  context.Stats.set(await countGas(context, s, event.transaction, "settle"));

  if (traded) {
    const d = await daily(context, block.timestamp);
    context.DailyStats.set({
      ...d,
      batchesWithTrades: d.batchesWithTrades + 1,
      volumeBase: d.volumeBase + p.volume,
      volumeQuote: d.volumeQuote + volumeQuote,
    });
  }
});

indexer.onEvent({ contract: "Metronome", event: "SettleRewardPaid", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const p = event.params;
  const id = p.settler.toLowerCase();
  // BatchSettled (same tx, earlier log) already counted the batch; the reward only adds to the total.
  const k = (await context.Keeper.get(id)) ?? { id, batchesSettled: 0, rewards: 0n, lastBlock: 0 };
  context.Keeper.set({ ...k, rewards: k.rewards + p.amount, lastBlock: event.block.number });

  const b = await batch(context, p.batchId);
  context.Batch.set({ ...b, settler: id, reward: p.amount });

  const s = await stats(context, { number: event.block.number, timestamp: event.block.timestamp });
  context.Stats.set({ ...s, keeperRewards: s.keeperRewards + p.amount });
});

/** Claims and cancels both pay out to the owner; they differ in the resulting status and the counter. */
async function payout(
  context: Ctx,
  event: { block: { number: number; timestamp: number }; transaction: { hash: string; gasUsed: bigint } },
  orderId: string,
  owner: string,
  baseOut: bigint,
  quoteOut: bigint,
  kind: "claim" | "cancel",
  closed: boolean,
) {
  const o = await context.Order.get(orderId);
  if (o) {
    context.Order.set({
      ...o,
      claims: o.claims + (kind === "claim" ? 1 : 0),
      baseOut: o.baseOut + baseOut,
      quoteOut: o.quoteOut + quoteOut,
      status: kind === "cancel" ? "cancelled" : closed ? "claimed" : o.status,
      closedBlock: closed ? event.block.number : o.closedBlock,
    });
  } else {
    context.log.warn(`${kind} for unknown order ${orderId}`);
  }

  const t = await context.Trader.get(owner.toLowerCase());
  if (t) context.Trader.set({ ...t, baseReceived: t.baseReceived + baseOut, quoteReceived: t.quoteReceived + quoteOut, lastBlock: event.block.number });

  let s = await stats(context, event.block);
  s = kind === "claim" ? { ...s, claims: s.claims + 1 } : { ...s, cancels: s.cancels + 1 };
  context.Stats.set(await countGas(context, s, event.transaction, kind));
}

indexer.onEvent({ contract: "Metronome", event: "Claimed", fields: TX_FIELDS }, async ({ event, context }) => {
  const p = event.params;
  await payout(context, event, p.orderId, p.owner, p.baseOut, p.quoteOut, "claim", p.closed);
});

indexer.onEvent({ contract: "Metronome", event: "OrderCancelled", fields: TX_FIELDS }, async ({ event, context }) => {
  const p = event.params;
  await payout(context, event, p.orderId, p.owner, p.baseOut, p.quoteOut, "cancel", true);
});

indexer.onEvent({ contract: "Metronome", event: "PoolUpdated" }, async ({ event, context }) => {
  const p = event.params;
  const id = `${p.isBuy ? "buy" : "sell"}-${p.tick}`;
  context.Pool.set({ id, isBuy: p.isBuy, tick: Number(p.tick), gen: Number(p.gen), remaining: p.remaining, updatedBlock: event.block.number });
});
