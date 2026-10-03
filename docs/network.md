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
| AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (has code, empty) | — | — |
| **TestAUSD** (tAUSD, ours; testnet quote since Oct 3; anyone can mint ≤10M per call) | [`0xA89Cdf8C92eC4f84654b44c0768FEC1b594cd091`](https://testnet.monadscan.com/address/0xA89Cdf8C92eC4f84654b44c0768FEC1b594cd091) | — | 6 |
| USDC (Circle; testnet quote Sep 26 – Oct 3) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` (verified) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 (verified) |

The old testnet WMON address `0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701` has **no code**. Don't use it.

## Metronome deployments

| | Testnet |
|---|---|
| **Metronome v2 (WMON/tAUSD), current** | [`0x753CC9fb3F26d208AF354a672255B7eDe78bcF24`](https://testnet.monadscan.com/address/0x753CC9fb3F26d208AF354a672255B7eDe78bcF24) (block 67,751,847): same contract as v2, quoted in our TestAUSD because Agora's testnet AUSD can't be obtained (the Monad team's suggestion) |
| Metronome v2 (WMON/USDC), retired Oct 3 | [`0x32f11865b2272B24f0F8174598EA64A82fc63761`](https://testnet.monadscan.com/address/0x32f11865b2272B24f0F8174598EA64A82fc63761) (block 65,885,642) |
| MetronomeHeartbeat (CRE receiver) | [`0x877aa5aBfC1250E19B00F2BB5dbc253057aC48e7`](https://testnet.monadscan.com/address/0x877aa5aBfC1250E19B00F2BB5dbc253057aC48e7) (block 67,756,898): settles the current market on CRE reports; accepts the mock forwarder until the workflow is deployed. The Sep 29 receiver `0xAe2C…27F4` served the USDC market |
| Metronome v2 (WMON/AUSD), retired | [`0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889`](https://testnet.monadscan.com/address/0x99E4DBCF8edE8092Be972307eB3d0Cd91ecBa889) (block 65,622,114) |
| Metronome v1 (retired) | [`0xd9eD8A732D8daE96855b40e1ebD65E9d36583ea1`](https://testnet.monadscan.com/address/0xd9eD8A732D8daE96855b40e1ebD65E9d36583ea1) (block 65,615,597): taker orders only |
| Config | 16 shards, tick 2048 = 0.025 tAUSD (AUSD on mainnet), min order 1 MON, fee 5 bps |
| Owner / deployer | `0x0D350bc1b4102732cFe243f80fe693f428572373` |

Machine-readable copy: `contracts/deployments/10143.json`.

**Live run on the WMON/tAUSD market (Oct 3):** deployer minted 10M tAUSD and 100k to the taker wallet; keeper + market maker (2 bid levels; the deployer has too little WMON for asks) and `pnpm taker`: a 1 MON sell filled against the MM's bid and settled two blocks later ([tx](https://testnet.monadscan.com/tx/0x3640222b700c386f3644966c1ec9302b7ba3335281970d892614eed5e2fea174)). The CRE workflow then wrote MON/USD and settled a waiting batch (see `cre/metronome-heartbeat/README.md`). Deploying token + market + two receivers and the runs cost ~1.65 MON; ~2.05 MON left.

**Live run on the WMON/USDC market (Sep 26):** keeper + market maker (2 levels a side, 1 MON) from the deployer, 4 taker orders from a separate wallet (`0xE4B1…D1a2`, `pnpm taker`). 3 filled, each settled 1–2 blocks after it was placed ([buy](https://testnet.monadscan.com/tx/0xde683349f9661c443e28d796c983afe4bcf2f00f735ad1107fa7a7f141354068), [sell](https://testnet.monadscan.com/tx/0xcab35e6cda2fa2210c9a80f812d924db76f226f2267ed36645bf291148f22376), [buy](https://testnet.monadscan.com/tx/0x45561c9eef646510a70ea191113f919a501fd143f0ae4f46bc11c98b545e5725)). The 4th (a sell) landed in the block where the MM re-quoted: the new bids join the book only when their batch settles, so it cleared empty and was refunded in full. The session cost the deployer ~1.2 MON; 4.08 MON left, so the bots run for demos, not around the clock.

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

**Rechecked Sep 26:** still 1 raw unit; a simulated `requestFunds(deployer)` still reverts `InsufficientFunds` (`0x356680b7`). AUSD has no public mint (`mint` reverts `0xdfcadb5b`); total supply 302.01M. Perpl's live `/api/v1/pub/context` lists this same AUSD (`0xa901…22dC`) as testnet collateral, although Perpl's docs call it "USD". No DEX on the current testnet lists AUSD (Uniswap's SDK testnet addresses have no code; Kuru testnet is USDC-only), so it can't be swapped for either.

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
- **Verified Sep 29 (CLI v1.35.0):** `cre workflow supported-chains` lists `monad-testnet` (selector 2183018362218727504, forwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, mock forwarder `0xB9F79d863261869B234c481D1f9A7af84AeAd192`) and `monad-mainnet` (selector 8481857512324358265, forwarder `0x76c9cf548b4179F8901cda1f8623568b58215E62`). Cron trigger, chain read and chain write all work on testnet: `simulate --broadcast` settled batch 66,620,995 in tx `0x02e34a3a…4995`.
- Deploy needs Chainlink to enable deploy access per account (requested Sep 29).

## Sources
- https://docs.agora.finance/developer/contract-deployments
- https://github.com/monad-crypto/protocols/pull/478
- https://docs.monad.xyz/tooling-and-infra/oracles
- https://docs.chain.link/cre/supported-networks-ts
