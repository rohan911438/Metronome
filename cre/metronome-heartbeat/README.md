# metronome-heartbeat

A Chainlink CRE workflow that keeps Metronome's batches clearing without our own keeper server, and brings an
off-chain MON/USD price on-chain as the market's price feed.

Every 30 seconds (cron trigger):

1. **Read** `nextPendingBatch()` on the market and `priceUpdatedAt()` on the receiver. If no batch is waiting and the
   price is under 5 minutes old, there is nothing to do, and the tick costs no gas.
2. **Fetch** MON/USD from an external API (Coinbase spot, `priceUrl` in the config) on every node; the DON agrees on the
   **median**. If the API is down, the report carries price 0 and settlement still goes ahead.
3. **Read** the latest block height `H` (when a batch is waiting).
4. **Report** `abi.encode(H, price, observedAt)`, signed by the DON, through the Monad forwarder to
   [`MetronomeHeartbeat`](../../contracts/src/cre/MetronomeHeartbeat.sol). It stores the price first, then calls
   `settle(H)`, which settles every pending batch up to `H`, so the workflow catches up however far behind it is.
   With no batch waiting, `H` is 0 and the report only refreshes the price.

The receiver serves the price as a Chainlink-style `IAggregatorV3` feed (8 decimals), so `Metronome.setOracle(receiver,
maxDeviationBps, maxStaleness)` makes the market's price guard check each clearing price against it: a batch that clears
too far from MON/USD is voided and refunded. On mainnet (WMON/AUSD) that's the intended setup. On testnet the workflow runs
as simulations, so the price isn't kept fresh and the guard stays off; the market maker bot still centers its quotes
on the CRE price whenever it is under 15 minutes old.

`settle` is permissionless, so the receiver adds no new power. It only accepts reports from the forwarder, ignores
prices that are older than the stored one or dated in the future, and any settle reward the market pays lands there for
the owner to sweep.

| | Monad testnet |
|---|---|
| Market | `0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889` |
| `MetronomeHeartbeat` | `0x99758F4e8Ce8E9A5364d1a6aBc2a7cF40ac9874f` |
| Forwarder it accepts | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` (CRE mock forwarder, used by `simulate --broadcast`) |
| Real forwarder (after deploy) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (switch with `setForwarder`) |

## Run it

From `cre/` (needs `cre login`, and `CRE_ETH_PRIVATE_KEY` in `cre/.env` for `--broadcast`):

```bash
go test ./...                                   # unit tests against a mocked chain
cre workflow simulate metronome-heartbeat --target staging-settings --non-interactive --trigger-index 0
cre workflow simulate metronome-heartbeat --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

Live runs on Oct 3, 2026 (`simulate --broadcast`, on the WMON/tAUSD market and receiver `0x877a…48e7`, since retired):

- **Price only:** no batch waiting and no price stored yet, so the workflow fetched MON/USD = $0.0314765 and wrote it in
  [`0xc610c306…f57b`](https://testnet.monadscan.com/tx/0xc610c30620f1c50803008ded82506ce5eeec1a1d72cbc713cd7dd75e696cf57b)
  (`PriceUpdated`, round 1).
- **Settle + price:** a sell placed in block 67,758,110; the workflow settled through 67,758,173 with MON/USD = $0.031471 in
  [`0xab20831c…c387`](https://testnet.monadscan.com/tx/0xab20831cb1395fe34511c3a1658336871d18f1b5d97b46f789a58eefe81fc387)
  (forwarder → `onReport` → `PriceUpdated` → `BatchSettled` → `Heartbeat`).

The first version (settle only, Sep 29) settled batch 66,620,995 on the retired USDC market in
[`0x02e34a3a…4995`](https://testnet.monadscan.com/tx/0x02e34a3a1c734793a2251446dac627fa3996002c2c2d62dcbf009dfd45d64995).

**Deploying:** Chainlink grants deploy access per organization (`cre account access`). For hackathons, Chainlink deploys
a workflow to the live CRE network for the team once its simulation succeeds, so the simulation runs above are the
submission evidence.

## Gas

Monad charges for the gas **limit**, not the gas used, so `gasLimit` (1.5M) is sized to a busy batch: settling 200 orders
at 16 shards costs ~882k gas ([benchmark](../../docs/benchmark.md)), plus the forwarder's overhead.

## Deploy

`cre workflow deploy metronome-heartbeat --target production-settings` once Chainlink enables deploy access for the
account, then `setForwarder(0xF834…4482)` on `MetronomeHeartbeat`.
