# Envio — Best Use of Envio ($1,000 cash)

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here before building.
> This is the all-teams $1,000 cash bounty. Envio's separate "for winning teams" perk (free Envio Cloud hosting) is non-cash and not a target.

## Open questions
- [x] HyperSync supports Monad testnet (`monad-testnet.hypersync.xyz`, at chain head on Sep 26) and mainnet. Outside Envio Cloud it needs a free API token (`ENVIO_API_TOKEN`)
- [x] Is hosting on Envio Cloud required, or is a self-run indexer enough? Moot: it is hosted on Envio Cloud since Oct 6

## Status (Sep 26)
Built and running against the local Anvil stack (see `indexer/README.md`), feeding the `/stats` page. Next: a token or Envio Cloud for testnet.

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

## Status (Oct 4): live on testnet
- `indexer/config.testnet-rpc.yaml` indexes the testnet market with no HyperSync token: thirdweb's public RPC (1,000 blocks per `eth_getLogs`) for sync, the official RPC (100 blocks) as fallback. Full sync from the market's deploy block (2.4M blocks) took well under an hour.
- Checked: 12 orders indexed = 12 on-chain nonces (deployer 9, taker 3). `/stats` renders volume, clearing prices, gas per action and keepers from it.
- The portfolio now reads order times, tx links and payouts from the indexer, falling back to RPC.
- Fix found on the way: the slim Node image has no CA certificates, so Envio's native HTTP client failed TLS; the Dockerfile installs `ca-certificates`.

## Status (Oct 6): hosted on Envio Cloud
- Public GraphQL: https://indexer.dev.hyperindex.xyz/5cebe67/v1/graphql (development plan, deployment of commit `0b3b812`, region EU, source HyperSync; first sync 1 minute, 62 events from both market addresses).
- Envio Cloud settings: indexer directory `indexer`, config `config.yaml`, release branch `envio` (push to `envio` to redeploy; keep it equal to `main`). With the default directory `./` the deploy failed with "missing envio package / Invalid version": Envio Cloud reads the envio version from that directory's package.json ([enviodev/hyperindex#1666](https://github.com/enviodev/hyperindex/issues/1666)).
- Checked against the chain: 15 indexed orders = 15 on-chain nonces (2 traders, both markets); progress block within 4 blocks of head.
- The web app uses it by default on testnet (`web/src/lib/indexer.ts`, overridable with `NEXT_PUBLIC_INDEXER_URL`); `/stats` renders from it in a testnet build (headless Edge check).
- Development deployments are deleted after 30 days (this one ~Nov 5, after winners are announced Nov 3) and the plan allows 3 deployments; each redeploy gets a new URL, so update `ENVIO_CLOUD_TESTNET`. Don't "Promote" (production is paid).
