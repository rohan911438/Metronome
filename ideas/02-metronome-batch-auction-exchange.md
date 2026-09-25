# Idea 2 — Metronome: MEV-free exchange that clears every Monad block (MAIN PICK)

**Track:** 01 Onchain Finance & Trading (also in the running for Grand Champion)

## One-liner
A fully onchain **frequent batch auction** (FBA) exchange. All orders in a block clear together at one uniform price.
Because the batch is one block, **the order of transactions inside it doesn't matter, so sandwiching and front-running are impossible**.
Monad's 300ms blocks make it feel real-time.

## Why only on Monad
| Chain | Batch = 1 block | Result |
|---|---|---|
| Ethereum | 12s | Price is stale, bad UX, clearing gas too expensive |
| L2s | ~250ms–2s | One sequencer decides the order; clearing gas is still expensive |
| **Monad** | **300ms, 600ms finality, cheap gas** | Near real-time, fully onchain, no offchain solvers |

CoW Protocol does batch auctions with **offchain solvers** you have to trust. Metronome does it **entirely onchain**, and only Monad makes that practical.

## Why it helps the ecosystem
- It's a public good: an MEV-protected venue for Monad tokens (MON/AUSD first)
- A router interface lets any Monad dApp or aggregator route swaps through it
- An open-source "parallel-friendly contract design" writeup that other Monad devs can reuse

## Core design
### Orders
- `placeOrder(side, tick, size)`: the order joins batch `B = block.number` (or `block.number / N`)
- MVP: orders last one batch; any unfilled part rolls over up to K batches (optional)
- Funds are escrowed when the order is placed

### Tick buckets (clearing cost is O(ticks), not O(orders))
- Each order adds its size to `buy[B][tick]` or `sell[B][tick]`
- Tick range is bounded around a reference price (for example ±256 ticks, with a Chainlink feed as a sanity bound or circuit breaker)
- `settle(B)` can be called by anyone once the block is later than B (keeper gets a small reward). It walks the ticks to find where cumulative demand meets supply, then stores `clearingTick` and a `proRata` ratio for the marginal tick

### Lazy claims (O(1) per user)
- Orders at a better tick than the clearing price fill fully. Orders at the clearing tick fill at `proRata`. Worse ticks are refunded
- `claim(orderId)` pays out at the uniform clearing price

### Designed for Monad's parallel execution (strong judge story)
- Problem: every order in a batch writes to the same `buy[B][tick]` slot, so the transactions conflict and get re-executed one after another
- Fix: **sharded buckets** `bucket[B][tick][hash(sender) % K]`. Writes spread out, and `settle` sums the K shards
- Storage is priced per **128-slot page** on Monad, so lay out the tick arrays so settle reads contiguous pages
- **Benchmark it**: show throughput and the re-execution rate with K=1 vs K=16. This is Monad-specific engineering most teams won't show

## Demo (2–3 min)
1. **Sandwich attack live**: a bot sandwiches a victim swap on a normal AMM (victim loses X%), then tries the same on Metronome (victim loses 0)
2. **Live batch visualizer**: supply and demand curves animate and clear every 300ms
3. Mobile-first trading UI with passkey login and a one-tap swap
4. Parallelism benchmark chart
5. Router: another contract swaps through Metronome in one call

## Stack
- Contracts: Solidity + Foundry, with fuzz/invariant tests on clearing math (conservation of funds, no fill beyond the limit price)
- Keeper: our own settle bot, plus a Chainlink CRE workflow (CRE bounty) if CRE supports Monad
- Data: the frontend reads contract events directly over RPC (no separate indexer)
- Frontend: Next.js PWA, mobile-first, with Privy passkey login and embedded wallet
- Market-maker bot so the demo has real liquidity
- Pair: MON/AUSD (testnet AUSD is available)

## Prizes we target (cash only; full details in `tracks/`)
- Track 01 ($10k) and Grand Champion ($25k)
- Agora "Best Mobile Trading App" (AUSD): mobile UI with AUSD pair
- Privy ($5k): passkey login, embedded wallet, popup-free signing
- Chainlink CRE ($3k): keeper/settlement workflow

## 18-day plan (Sep 25 → Oct 13), solo scope
Cut for now: multi-batch orders, router contract, extra markets.

| Days | Work |
|---|---|
| 1–2 | Final spec, math for clearing and pro-rata, Foundry setup, testnet RPC |
| 3–7 | Core contracts: place / settle / claim / cancel, sharded buckets, fuzz + invariant tests |
| 8–10 | Settle keeper, MM bot, sandwich-attack simulator, parallelism benchmark |
| 8–13 | Frontend: trading UI, batch visualizer, Privy login (in parallel) |
| 11–13 | Chainlink CRE workflow |
| 14–15 | Mainnet deploy (chain 143), bug bash, security pass |
| 16–17 | Polish, README with diagrams, **demo video** |
| 18 | Submit (don't leave it to the last hour) |

## Risks and mitigations
- Complex math → keep ticks discrete, one market only, heavy fuzzing
- No liquidity → your own MM bot plus seeded liquidity
- Track 01 has strong teams → win on novelty (onchain FBA, parallel-aware design) plus a polished demo
