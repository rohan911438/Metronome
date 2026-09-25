# Envio — Indexer ($5,000 in free Cloud hosting)

**Envio HyperIndex** turns contract events into a GraphQL API that the frontend can query.

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here.
> Public listing says the prize is **free Envio Cloud hosting** (credits, not cash).

## Likely eligibility
- Use Envio HyperIndex to index your Monad contracts
- The indexed data is used in the product

## What we do to qualify
| Indexed data | Where it's shown |
|---|---|
| `OrderPlaced`, `OrderCancelled`, `Claimed` events | "My orders" and fill history in the app |
| `BatchSettled` (clearing price, volume, fill ratio) | Price chart and the live batch-clearing chart |
| Totals across batches | Stats page: volume, number of batches, MEV saved vs. an AMM |

We need an indexer for these screens anyway, so this bounty costs about 1 extra day.

## How we plan to win
- The live clearing chart and price chart run fully on Envio data
- Hosted on Envio Cloud with a public GraphQL endpoint linked in the README
