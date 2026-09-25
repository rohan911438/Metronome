# Metronome contracts

Foundry project for the Metronome batch-auction exchange. Design: [`../docs/architecture.md`](../docs/architecture.md).

## Layout

| Path | What |
|---|---|
| `src/Metronome.sol` | The market: `placeOrder`, `settle`, `claim`, `claimMany`, `settleAndClaim` |
| `src/lib/ClearingLib.sol` | Uniform clearing price: volume-maximising tick, pro-rata only at the marginal tick |
| `src/lib/TickMath.sol` | Price grid: `price(t) = P_MIN × 1.001^t` over 4096 ticks |
| `src/lib/TickBitmap.sol` | Two-level bitmap of active ticks, merged across shards at settle |
| `src/interfaces/` | `IMetronome` (integrate here) and the Chainlink feed interface |
| `src/mocks/` | Test-only tokens and price feed |
| `script/Deploy.s.sol` | Deploys a market; writes `deployments/<chainId>.json` |

## Tests

67 tests: unit, fuzz, differential and invariant.

| Suite | What it proves |
|---|---|
| `ClearingLib.t.sol` | **Differential fuzz** against a brute force over all 4096 ticks: same maximal volume, clearing tick achieves it, both sides trade exactly the volume |
| `MetronomeInvariant.t.sol` | Random orders, settles, claims and fee changes (256 runs × 100 calls): **everyone can always be paid out**, dust stays ≤ 1 wei per order, buyers never receive more base than sellers gave, **no order fills beyond its limit** |
| `Metronome.t.sol` | Every path: escrow, rationing, price improvement, refunds, **sandwich attempt earns nothing**, fees, keeper reward, pausing, broken/stale/deviating oracles |
| `TickMath.t.sol` | Every tick against a 1e36-precision reference; strictly increasing, 10 bps apart |
| `TickBitmap.t.sol` | Set/merge semantics, fuzzed |

Line coverage: libraries 100%, total ~91% (`forge coverage --ir-minimum` under-reports some lines that tests assert on).

## Gas

Measured by `test/Gas.t.sol` with Foundry's Ethereum gas schedule. Monad prices cold storage differently; testnet numbers will be added after deploy.

| Action | Gas |
|---|---|
| `placeOrder`, new tick in batch | 127k |
| `placeOrder`, tick already active | 90k |
| `claim`, filled order | 42k |
| `settle`, 1 active tick | 66k |
| `settle`, 100 active ticks | 441k |
| `settle`, **200 orders on 2 ticks** | **99k**: cost follows ticks, not orders |

## Usage

```sh
git submodule update --init --recursive   # first time only
forge build
forge test                                # full suite, ~2 min (fuzz + invariants)
forge test --match-contract Gas -vv       # gas numbers
```

### Deploy

```sh
cp .env.example .env                      # set PRIVATE_KEY (a funded testnet key)
source .env
forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
```

Defaults on testnet: WMON/AUSD, tick 2048 = 0.025 AUSD, 16 shards, 5 bps fee. Override with the env vars documented in the script.
