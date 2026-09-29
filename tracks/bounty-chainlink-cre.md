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

## Status (Sep 29)
- Built: `cre/metronome-heartbeat` (Go) + `contracts/src/cre/MetronomeHeartbeat.sol` receiver, live on testnet at `0xAe2C…27F4`.
- Proven: `cre workflow simulate --broadcast` settled real pending batch 66,620,995 on Monad testnet (tx `0x02e34a3a…4995`).
- Blocked: `cre workflow deploy` needs Chainlink to enable deploy access (account shows "Deploy Access: Not enabled"; requested). After deploy, call `setForwarder(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`.
- Not done: the price-sanity-check job (no Chainlink MON/USD feed on Monad; the contract's own oracle guard covers it if enabled).
