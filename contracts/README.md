# Metronome contracts

Foundry project for the Metronome batch-auction exchange. Design: [`../docs/architecture.md`](../docs/architecture.md).

## Layout

| Path | What |
|---|---|
| `src/lib/TickMath.sol` | Price grid: `price(t) = P_MIN × 1.001^t` over 4096 ticks |
| `src/lib/TickBitmap.sol` | Two-level bitmap of active ticks, merged across shards at settle |
| `src/interfaces/` | External interfaces (Chainlink feed) |
| `src/mocks/` | Test-only tokens and price feed |
| `test/` | Unit, fuzz, invariant and differential tests |

## Usage

```sh
git submodule update --init --recursive   # first time only
forge build
forge test
forge fmt
```

Deploying needs a `.env` based on `.env.example`.
