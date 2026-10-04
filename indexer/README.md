# Metronome indexer (Envio HyperIndex)

Indexes every Metronome event into Postgres and serves it as GraphQL (Hasura). The app's `/stats` page reads it;
nothing else depends on it; trading reads the chain directly.

| Entity | What it holds |
|---|---|
| `Stats` (id `global`) | all-time orders, traders, batches, volume (base and quote), claims, cancels, keeper rewards, order-to-settlement delay, gas per action |
| `DailyStats` | the same per UTC day |
| `Batch` | one per batch: clearing tick and price, volume, rationed side, who settled it and when |
| `Order` | every order with its payouts (fills plus refunds) and status |
| `Trader`, `Keeper`, `Pool` | per trader, per settler, per resting pool |

## Run it

Envio ships Linux/macOS binaries only, so it runs in Docker (on Windows too).

```bash
# Local chain: start `pnpm dev:local` first (Anvil on :8545), then
cd indexer && docker compose up --build -d
# GraphQL: http://localhost:8080/v1/graphql   (Hasura console: http://localhost:8080, admin secret "testing")

# Monad testnet, no token: syncs over public RPCs (thirdweb, 1,000 blocks per call; the official RPC as fallback).
# The first sync from the market's deploy block takes about an hour.
ENVIO_CONFIG=config.testnet-rpc.yaml docker compose up --build -d

# Monad testnet over HyperSync (much faster; needs a free token from https://envio.dev/app/api-tokens)
ENVIO_CONFIG=config.yaml ENVIO_API_TOKEN=... docker compose up --build -d

# Start over (drops the database)
docker compose down -v
```

The web app reads `NEXT_PUBLIC_INDEXER_URL` (defaults to the local endpoint above on the local chain).

## Example query

```graphql
{
  Stats { orders traders batchesWithTrades volumeQuote settleDelayBlocksSum settleDelaySamples }
  Batch(where: { volume: { _gt: "0" } }, order_by: { id: desc }, limit: 5) { id clearingTick volume settler }
  Keeper(order_by: { batchesSettled: desc }) { id batchesSettled rewards }
}
```

Checked against raw chain logs on the local stack: orders, resting orders, traders, batches settled, batches with
trades, base and quote volume, claims and cancels all match exactly; keeper counts match per settle-tx sender.
