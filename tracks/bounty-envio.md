# Envio — Best Use of Envio ($1,000 cash)

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here before building.
> This is the all-teams $1,000 cash bounty. Envio's separate "for winning teams" perk (free Envio Cloud hosting) is non-cash and not a target.

## Open questions
- [ ] Confirm HyperIndex / HyperSync support Monad testnet (10143) and mainnet (143)
- [ ] Is hosting on Envio Cloud required, or is a self-run indexer enough?

## What we build: Metronome indexer (`indexer/`)

An Envio HyperIndex project over the Metronome contract, served as GraphQL.

| Event | Entities it updates |
|---|---|
| `OrderPlaced` | `Order` (owner, side, tick, size, resting), `Trader` (order count) |
| `BatchSettled` | `Batch` (clearing price, volume, rationed side, voided), `DailyStats` (volume, batches, trades) |
| `Claimed`, `OrderCancelled` | `Order` (paid out base/quote, status), `Trader` (volume, fills) |
| `PoolUpdated` | `Pool` (resting size per side and tick) |
| `SettleRewardPaid` | `Keeper` (batches settled, rewards) |

## What it unlocks in the app
- **`/stats` page:** all-time volume, batches settled, trades, unique traders, average fill time, gas per order/settle/claim, keeper leaderboard. RPC alone can't do this (public RPCs cap `eth_getLogs` at ~100 blocks)
- **Full portfolio history:** fill prices and payouts for every order ever, not just the last 100 blocks
- **Price chart:** clearing price per batch over time

The app keeps working without the indexer: every page falls back to plain RPC reads (the current design), so the indexer is an upgrade, not a dependency.

## How we plan to win
- An indexer that is actually used by the product (stats, history, charts), not a demo query
- Show the GraphQL endpoint and a query in the README
