# Chainlink — Best CRE workflow ($3,000)

**CRE** = Chainlink Runtime Environment: workflows that run on Chainlink's network and can read data and write to contracts.

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here.
> Public listing says: "Best CRE workflow".

## Likely eligibility
- Build a working **CRE workflow** that is a real part of the product (not a demo on the side)
- The workflow interacts with contracts on Monad

## What we do to qualify
| Workflow job | How it works in Metronome |
|---|---|
| **Settle keeper** | Every block (or every N blocks), the workflow calls `settle(batchId)` so batches clear without our own server |
| **Price sanity check** | Before settling, it reads a Chainlink price feed for MON/USD. If the clearing price is too far from the reference, the batch is flagged or the circuit breaker trips |
| **Batch stats** (stretch goal) | Posts batch volume and clearing price to the indexer or a dashboard |

## How we plan to win
- Pitch it as "Chainlink is the heartbeat of Metronome": CRE is what makes the exchange tick every block
- Show the workflow running live in the demo video, with its settle transactions on the Monad explorer
- Keep our own settle bot as a fallback, and explain why CRE is better (no single server to go down)

## Open questions
- [x] Does CRE support Monad? **Yes, mainnet and testnet** (see `docs/network.md`). Exact capabilities still to confirm with the CLI
- [x] Is a MON/USD price feed available on Monad? **No Chainlink push feed listed; Pyth MON/USD exists** (see `docs/network.md`)
- [ ] How fast can a CRE workflow trigger, and can it keep up with 300ms blocks? If not, settle every N blocks

## Requirements (as published for this hackathon; confirm on the dashboard)
> Build, simulate, or deploy a CRE Workflow that's used as an orchestration layer within your project. Your project must:
> - Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent
> - Demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network
> - Be meaningfully used in your project
>
> If you show a successfully simulated workflow execution, the Chainlink team will deploy it to the live CRE network for you.

| Requirement | How we meet it |
|---|---|
| Blockchain + external API | Every report carries MON/USD fetched from Coinbase's API (median across the DON) into Monad |
| Simulation or deployment | `simulate --broadcast` runs on Oct 3: price-only report and settle + price, both on Monad testnet |
| Meaningfully used | The workflow is the market's keeper (settles every batch) and its price feed (`IAggregatorV3` for the oracle guard) |

## Status (Oct 3)
- Built: `cre/metronome-heartbeat` (Go) + `contracts/src/cre/MetronomeHeartbeat.sol` receiver, live on testnet at `0x9975…874f` (Oct 3, for the WMON/AUSD market; earlier receivers `0x877a…48e7` and `0xAe2C…27F4` served retired markets). The market maker bot quotes around the CRE price. 10 Foundry + 7 Go tests.
- **Real trade settled by CRE (Oct 3):** taker buy [`0x3030…`](https://testnet.monadscan.com/tx/0x3030ca6c2530804178789de40a943ee7212a3db59caed31de177ff62c4a69fec) settled by the workflow with MON/USD in the same report [`0x2342…`](https://testnet.monadscan.com/tx/0x23421b9b8c6eb4098da8df6e313b5535facbda8d8be293f9f8862b08f8c7b7f0); no keeper bot running. After an out-of-gas the forwarder hid, each report's gas limit is sized from an estimate (× 2 + 250k) and the workflow re-checks that the batch settled; verified with a taker buy and sell, both settled by CRE (details in the workflow README)
- Proven on testnet: price-only report `0xc610c306…f57b` and settle + price `0xab20831c…c387` (see `cre/metronome-heartbeat/README.md`).
- Deploy access: still "Not enabled" on Oct 3. Not required: simulation is accepted, and Chainlink deploys simulated workflows for hackathon teams. If it gets enabled: `cre workflow deploy metronome-heartbeat --target production-settings`, then `setForwarder(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`.
- Price source: Pyth Hermes now answers "unauthorized" without a key, so the workflow uses Coinbase's public spot endpoint.
