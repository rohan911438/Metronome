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
