# Metronome contracts

Foundry project for the Metronome batch-auction exchange. Design: [`../docs/architecture.md`](../docs/architecture.md).

## Layout

| Path | What |
|---|---|
| `src/Metronome.sol` | The market: taker and resting orders, `settle`, `claim`, `cancel`, `settleAndClaim` |
| `src/lib/ClearingLib.sol` | Uniform clearing price: volume-maximising tick, pro-rata only at the marginal tick |
| `src/lib/TickMath.sol` | Price grid: `price(t) = P_MIN × 1.001^t` over 4096 ticks |
| `src/lib/TickBitmap.sol` | Two-level bitmap of active ticks, merged across shards at settle |
| `src/demo/` | `MiniAMM` + `SandwichLab`: the same sandwich on an AMM and on Metronome |
| `src/interfaces/` | `IMetronome` (integrate here) and the Chainlink feed interface |
| `src/mocks/` | Test-only tokens and price feed |
| `script/Deploy.s.sol` | Deploys a market; writes `deployments/<chainId>.json` |

## Tests

90 tests: unit, fuzz, differential and invariant.

| Suite | What it proves |
|---|---|
| `ClearingLib.t.sol` | **Differential fuzz** against a brute force over all 4096 ticks: same maximal volume, clearing tick achieves it, both sides trade exactly the volume |
| `MetronomeInvariant.t.sol` | Random taker and resting orders, settles, claims, cancels and fee changes (256 runs × 100 calls): **everyone can always be paid out** with only wei-level dust left, **no order fills beyond its limit**, pools stay consistent, and **the resting book never crosses** |
| `Resting.t.sol` | Makers post once and fill across batches, partial claims, pro-rata between makers, price improvement, cancels (including that a cancel can't pull liquidity from a closed batch), dust pools frozen, maker pays no fee |
| `SandwichLab.t.sol` | 20k MON victim on a 1M pool: AMM victim overpays **4.17%** and the attacker makes **+729 AUSD**; on Metronome the victim pays the clean price and the attacker only loses fees |
| `Metronome.t.sol` | Every path: escrow, rationing, price improvement, refunds, **sandwich attempt earns nothing**, fees, keeper reward, pausing, broken/stale/deviating oracles |
| `TickMath.t.sol` | Every tick against a 1e36-precision reference; strictly increasing, 10 bps apart |
| `TickBitmap.t.sol` | Set/merge semantics, fuzzed |

Line coverage: libraries 100%, total ~91% (`forge coverage --ir-minimum` under-reports some lines that tests assert on).

## Gas

Measured by `test/Gas.t.sol` with `--isolate` (each call its own transaction, cold storage, 21k base included), on Foundry's Ethereum gas schedule. Monad charges more for cold storage; earlier live testnet numbers are in [`../docs/network.md`](../docs/network.md).

| Action | Gas |
|---|---|
| `placeOrder`, taker, new tick in batch | 198k |
| `placeOrder`, taker, tick already active | 135k |
| `placeOrder`, resting | 250k (once, then it stays) |
| `claim`, taker | 85k |
| `claim`, resting (harvest) | 120k |
| `cancel`, resting | 95k |
| `settle`, taker vs. 1 pool | 224k |
| `settle`, 10 / 100 active ticks | 330k / 1.7M |
| `settle`, **200 orders on 2 ticks** | **201k**: cost follows ticks, not orders |

## Usage

```sh
git submodule update --init --recursive   # first time only
forge build
forge test                                # full suite, ~2 min (fuzz + invariants)
forge test --match-contract Gas -vv --isolate   # gas numbers
```

### Deploy

```sh
cp .env.example .env                      # set PRIVATE_KEY (a funded testnet key)
source .env
forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
```

Defaults on testnet: WMON/AUSD, tick 2048 = 0.025 AUSD, 16 shards, 5 bps fee. Override with the env vars documented in the script.
