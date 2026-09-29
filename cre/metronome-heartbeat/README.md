# metronome-heartbeat

A Chainlink CRE workflow that keeps Metronome's batches clearing without our own keeper server.

Every 30 seconds (cron trigger):

1. **Read** `nextPendingBatch()` on the market. If it is 0 there is nothing to do, and the tick costs no gas.
2. **Read** the latest block height `H`.
3. **Report** `abi.encode(H)`, signed by the DON, through the Monad forwarder to
   [`MetronomeHeartbeat`](../../contracts/src/cre/MetronomeHeartbeat.sol), which calls `settle(H)`. One report settles every
   pending batch up to `H`, so the workflow catches up however far behind it is.

`settle` is permissionless, so the receiver adds no new power. It only accepts reports from the forwarder, and any
settle reward the market pays lands there for the owner to sweep.

| | Monad testnet |
|---|---|
| Market | `0x32f11865b2272B24f0F8174598EA64A82fc63761` |
| `MetronomeHeartbeat` | `0xAe2C3113aF7C897DAcc456Dc78234724179d27F4` |
| Forwarder it accepts | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` (CRE mock forwarder, used by `simulate --broadcast`) |
| Real forwarder (after deploy) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (switch with `setForwarder`) |

## Run it

From `cre/` (needs `cre login`, and `CRE_ETH_PRIVATE_KEY` in `cre/.env` for `--broadcast`):

```bash
go test ./...                                   # unit tests against a mocked chain
cre workflow simulate metronome-heartbeat --target staging-settings --non-interactive --trigger-index 0
cre workflow simulate metronome-heartbeat --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

Live run on Sep 29, 2026: the workflow found pending batch 66,620,995 and settled through 66,621,054 in
[`0x02e34a3a…4995`](https://testnet.monadscan.com/tx/0x02e34a3a1c734793a2251446dac627fa3996002c2c2d62dcbf009dfd45d64995)
(forwarder → `onReport` → `BatchSettled` → `Heartbeat`).

## Gas

Monad charges for the gas **limit**, not the gas used, so `gasLimit` (1.5M) is sized to a busy batch: settling 200 orders
at 16 shards costs ~882k gas ([benchmark](../../docs/benchmark.md)), plus the forwarder's overhead.

## Deploy

`cre workflow deploy metronome-heartbeat --target production-settings` once Chainlink enables deploy access for the
account, then `setForwarder(0xF834…4482)` on `MetronomeHeartbeat`.
