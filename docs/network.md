# Network facts

Verified values the code and bots rely on. **"Verified"** means checked with an RPC call, not just read in docs.

## Chains

| | Monad testnet | Monad mainnet |
|---|---|---|
| Chain ID | 10143 (verified) | 143 |
| Public RPC | `https://testnet-rpc.monad.xyz` (verified) | `https://rpc.monad.xyz` |

## Tokens

| Token | Testnet | Mainnet | Decimals |
|---|---|---|---|
| **AUSD** (quote) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (verified) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 6 (verified) |
| **WMON** (base) | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` (verified) | TBC | 18 (verified) |
| AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (has code) | — | — |

The old testnet WMON address `0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701` has **no code**. Don't use it.

## Metronome deployments

| | Testnet |
|---|---|
| **Metronome v2 (WMON/AUSD), current** | [`0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889`](https://testnet.monadscan.com/address/0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889) (block 65,622,114): taker + resting orders |
| Metronome v1 (retired) | [`0xd9eD8A732D8daE96855b40e1ebD65E9d36583ea1`](https://testnet.monadscan.com/address/0xd9eD8A732D8daE96855b40e1ebD65E9d36583ea1) (block 65,615,597): taker orders only |
| Config | 16 shards, tick 2048 = 0.025 AUSD, min order 1 MON, fee 5 bps |
| Owner / deployer | `0x0D350bc1b4102732cFe243f80fe693f428572373` |

Machine-readable copy: `contracts/deployments/10143.json`.

**Smoke tests (Sep 25):**
- v1: wrap → place sell 1 WMON → settle (no buyers, volume 0) → claim returned exactly 1 WMON; contract left holding 0.
- v2: resting sell 1 WMON @ tick 2050 → settle (joined the pool; `getRestingBook` showed it) → cancel returned exactly 1 WMON, pool removed from the book; contract left holding 0.

**Measured gas on Monad testnet** (Monad charges more than Ethereum for cold storage):

| Action | Monad testnet | Foundry (Ethereum schedule) |
|---|---|---|
| `placeOrder` (first order in a batch) | 247,900 | 127,465 |
| `settle` (1 active tick, 16 shards) | 275,775 | 66,109 (4 shards) |
| `claim` | 90,930 | 41,993 |
| v2 `placeOrder` (resting) | 305,556 | 250,476 (isolated) |
| v2 `settle` (1 pool joins, 16 shards) | 760,007 | 302,696 (isolated, 4 shards) |
| v2 `cancel` (resting) | 452,719 | 95,281 (isolated, 4 shards) |

Settle's and cancel's fixed cost is mostly scanning 16 shards cold (bitmap summaries, and in v2 the per-shard batch chains: ~32 cold reads). That's the price of the parallel-friendly layout. The Phase 5 benchmark compares K=1/4/16 to pick the right shard count.

## AUSD faucet status

The Agora testnet faucet (`0xd236…ee6C`, `requestFunds(address)`, 10,000 AUSD per drip) was **empty on Sep 25**: it held 1 raw unit and reverted with `InsufficientFunds`.

## Oracles

- **Chainlink Data Feeds (push):** no MON/USD feed listed for Monad in Monad's docs (checked Sep 25). Chainlink Data Streams (pull) is live.
- **Pyth MON/USD:** available on testnet and mainnet (pull model).
  - Testnet contract `0x2880aB155794e7179c9eE2e38200202908C17B43`
  - Feed ID `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1`
- **Decision:** the contract reads any `IAggregatorV3` feed, and the guard is optional. If we turn it on, we use Pyth's Chainlink-compatible adapter, or a Chainlink feed if one appears.

## Chainlink CRE

- Monad **mainnet and testnet are both supported** (Chainlink docs, checked Sep 25).
  - Mainnet: CLI ≥ v1.29.0, TS SDK ≥ v1.18.0
  - Testnet: CLI ≥ v1.30.0, TS SDK ≥ v1.19.0
- Which capabilities work on Monad (cron, log trigger, EVM write) is confirmed with `cre workflow supported-chains` after login.

## Sources
- https://docs.agora.finance/developer/contract-deployments
- https://github.com/monad-crypto/protocols/pull/478
- https://docs.monad.xyz/tooling-and-infra/oracles
- https://docs.chain.link/cre/supported-networks-ts
