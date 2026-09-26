# Shard benchmark: K = 1, 4, 16

Does splitting each batch's order book into K shards make Metronome more parallel on Monad, and what does it cost?
Measured on Sep 26, 2026. Run it yourself:

```bash
cd contracts && forge test --match-contract ShardBench --isolate -vv
```

`--isolate` runs every call as its own transaction, so storage starts cold like on chain. Source:
[`contracts/test/ShardBench.t.sol`](../contracts/test/ShardBench.t.sol).

## Setup

200 wallets each place one taker order (1 MON) in the same batch: 100 buys and 100 sells over 20 ticks per side, so
the batch clears. Then the batch is settled, all 200 orders are claimed, and two fixed costs are measured on their
own: settling a batch with a single order, and cancelling a resting order that has joined its pool.

**Parallelism metric.** Monad executes a block's transactions optimistically in parallel and re-executes any
transaction whose inputs an earlier one changed. From each `placeOrder`'s recorded storage reads and writes we compute
the **critical path**: the longest chain of orders in which each touches a slot an earlier one wrote. 1 means all 200
orders are independent; 200 means fully serial.

## Results (gas per transaction)

| K | place (avg) | settle, 200 orders | settle, 1-order batch | claim (avg) | cancel resting | critical path: Metronome storage | critical path: all storage | critical path: all but the escrow balance |
|---|---|---|---|---|---|---|---|---|
| 1 | 110,749 | 272,587 | 75,788 | 57,337 | 91,216 | 24 | 105 | 24 |
| 4 | 118,035 | 432,982 | 92,066 | 57,337 | 92,380 | 17 | 104 | 17 |
| 16 | 130,919 | 882,017 | 157,278 | 57,337 | 97,295 | 10 | 101 | 10 |

The first order at a new tick in a batch costs the most (max place: 224,984 at every K).

## What it shows

1. **Sharding works on Metronome's own storage.** The critical path of Metronome's storage falls from 24 (K=1) to
   10 (K=16): orders in different shards don't touch the same book slots.
2. **But the token escrow serializes everything.** Every `placeOrder` pulls its escrow with `transferFrom`, which
   writes the exchange's balance slot in that token. That one slot per token puts all ~100 buyers (AUSD) and all ~100
   sellers (WMON) in a chain, so the whole-transaction critical path stays at ~100 for every K. Excluding only that
   slot, the path drops to exactly the Metronome-only numbers (24 / 17 / 10), so the escrow balance is the only
   cross-contract bottleneck.
3. **Shards cost settle gas.** Settle scans every shard: K=16 makes a busy batch's settle 3.2× the cost of K=1
   (882k vs 273k) and doubles the fixed cost of a small batch (157k vs 76k). Placing costs +18%; claims don't change.

## Decision and next step

- With escrow transfers in the hot path, more shards buy little real parallelism and cost settle gas, so the
  deployed markets should use a small K (the current testnet market uses K=16; the mainnet choice is open).
- **The real unlock is escrow without a shared slot:** a deposit model where users deposit once and orders debit an
  internal per-user balance. Then `placeOrder` would write only the user's own balance and their shard, and K=16's
  path of 10 would become the whole-transaction path, instead of ~100.
