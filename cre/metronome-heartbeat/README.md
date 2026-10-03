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

**Oct 3, CRE as the only keeper** (no keeper bot running; WMON/AUSD market, receiver `0x9975…874f`): the market maker quoted around the CRE price (bids ticks 2269/2271, asks 2275/2277 ≈ $0.0312); a taker [bought 1 MON](https://testnet.monadscan.com/tx/0x3030ca6c2530804178789de40a943ee7212a3db59caed31de177ff62c4a69fec) at tick 2275 and the next workflow run [settled that batch with MON/USD $0.03129](https://testnet.monadscan.com/tx/0x23421b9b8c6eb4098da8df6e313b5535facbda8d8be293f9f8862b08f8c7b7f0) within 4 seconds. Earlier in the run, reports at a 1.5M gas limit ran out of gas on a batch where 4 resting orders joined fresh pools (~1.02M gas through the receiver); the forwarder swallowed it and the simulator reported success. Fixed: 3M limit ([settled](https://testnet.monadscan.com/tx/0x4d30147547c22f4635fb399700b3dbcb957f586dc174d39fcf0fd412e1690798)) and a post-report check in the workflow. Cost: each report is billed at its full limit (0.15–0.31 MON at 102 gwei), so CRE runs are for demos until the deployed workflow runs on Chainlink's network.

**Oct 3, after the gas fix:** a taker [bought](https://testnet.monadscan.com/tx/0xa75315ec6965c572086eb642b02ffababb3fc1e2dd81840254b6ccf6e02629b5) and [sold](https://testnet.monadscan.com/tx/0x279a4a965be3a504ce97ea6acf8b5ec64f8ed1e558777e2e59d911207729c356) 1 MON; the workflow settled each batch ([buy](https://testnet.monadscan.com/tx/0x08818317cda937c6343664e2017e194148a13879310a70cf79df4285051859d0): estimate 771k → limit 1.79M; [sell](https://testnet.monadscan.com/tx/0x151358e06c216b7e772f51731e6360547ff2761f0a74fcb425cbb40ff82bb8d1): 784k → 1.82M), and the taker claimed both fills itself. A price-only report: estimate 37k → limit 324k ([tx](https://testnet.monadscan.com/tx/0x991a28ebd24e3de04b7e9062730649ddedd32c4dec8ba5b0fd21a42531d703e7)).

The first version (settle only, Sep 29) settled batch 66,620,995 on the retired USDC market in
[`0x02e34a3a…4995`](https://testnet.monadscan.com/tx/0x02e34a3a1c734793a2251446dac627fa3996002c2c2d62dcbf009dfd45d64995).

**Deploying:** Chainlink grants deploy access per organization (`cre account access`). For hackathons, Chainlink deploys
a workflow to the live CRE network for the team once its simulation succeeds, so the simulation runs above are the
submission evidence.

## Gas

Monad charges for the gas **limit**, not the gas used, so each report's limit is sized from an estimate: the workflow
reads the receiver's `forwarder()` and estimates `onReport("", report)` as that address (the only caller the receiver
accepts), then uses **estimate × 2 + `gasOverhead` (250k)**, capped at `gasLimit` (4M). An estimate that reverts stops the
run before anything is written.

Why: a flat 1.5M limit ran out on Oct 3 on a batch where four resting orders joined fresh pools (receiver estimate ~1.02M;
the on-chain cost was higher than the estimate), and a flat 3M worked but bills ~0.31 MON per report at 102 gwei. With
the estimate: a price-only report gets ~324k (~0.03 MON), settling a taker fill against the pools ~1.8M. The forwarder
swallows a receiver that runs out of gas and a simulated write doesn't report the receiver's status, so the workflow
also re-reads `nextPendingBatch()` after each settle report and fails loudly if the batch is still pending.

## Deploy

`cre workflow deploy metronome-heartbeat --target production-settings` once Chainlink enables deploy access for the
account, then `setForwarder(0xF834…4482)` on `MetronomeHeartbeat`.
