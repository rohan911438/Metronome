# Metronome bots

TypeScript + [viem](https://viem.sh). Design: [`../docs/architecture.md`](../docs/architecture.md) §4.

| Bot | What it does | Sends a transaction when |
|---|---|---|
| **Keeper** (`src/keeper.ts`) | Settles closed batches and pays taker orders out (`settleAndClaim`), and collects fills for resting orders (`claimMany`). Users never press "claim" | A closed batch is pending, a taker is unpaid, or a resting order has something to collect |
| **Market maker** (`src/mm.ts`) | Keeps a ladder of **resting** orders around a reference price (MiniAMM spot locally, else last clearing price, else `START_TICK`) | The reference moves `MM_REQUOTE_TICKS` or more; it has fills to collect |

Both set each transaction's gas limit to `estimateGas + 20%`: Monad charges for the gas **limit**, not gas used. Both poll at block speed (viem's default 4 s polling would wait ~13 Monad blocks per receipt).

## Run

```sh
pnpm install                     # from the repo root
cp bots/.env.example bots/.env   # optional; keys default to contracts/.env
pnpm keeper                      # NETWORK=testnet by default
pnpm mm
```

After changing a contract's ABI: `forge build` in `contracts/`, then `pnpm --filter @metronome/bots abi`.

## End-to-end test (local)

```sh
pnpm e2e:local
```

Starts Anvil, deploys the full stack (`contracts/script/DeployLocal.s.sol`: mock WMON/AUSD, Metronome, MiniAMM, SandwichLab), runs the keeper and market maker, has three traders send random taker orders for 20 blocks, runs the sandwich lab, and checks that takers were filled, every batch settled and every order was paid out.

Last run (Sep 25):

| | |
|---|---|
| Taker orders / filled | 60 / 55 |
| Keeper | 19 settle txs, 60 claims, 9 resting harvests, 0 errors |
| Market maker | 20 orders posted, re-quoted when the AMM price moved, 0 errors |
| Sandwich on AMM | victim overpaid **527 bps**, attacker **+119.76 AUSD** |
| Sandwich on Metronome | victim overpaid **0 bps**, attacker **−2.50 AUSD** (fees) |
