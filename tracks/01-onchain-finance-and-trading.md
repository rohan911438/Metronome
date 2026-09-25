# Track 01 — Onchain Finance & Trading (MAIN TRACK)

**Prize:** $30,000 split evenly between 3 winners, so **$10,000 per winner**.
**Extra perk (not cash, not a goal):** Chainstack gives annual Pro plans to Track 01 winners.

## What the track asks for (official wording, summarised)
- Aimed at teams experienced in shipping trading, lending, or market-making products
- Example ideas from Monad:
  - "Fully onchain order books that do not need an offchain matching engine"
  - Perps with funding updated every block
  - Undercollateralized lending using onchain credit history

Source: https://monad.xyz/developers/hackathons/metropolis

## Eligibility: what we do to qualify
| Requirement | Metronome |
|---|---|
| Finance or trading product on Monad | An exchange: orders, matching, settlement |
| Onchain | Placing orders, finding the price, and settling all happen in contracts. **No offchain matching engine**, which is exactly the track's first example |
| Working product | Deployed contracts plus a live UI that real users can trade on |
| Built in the window | New repo, started Sep 25, 2026 |

## How we plan to win
Judges are GPs from Paradigm, Electric Capital and Galaxy, plus ecosystem founders and engineers. They reward: a new idea, clear use of Monad, technical depth, and a working demo.

### 1. New idea
- Batch auctions onchain with **no offchain solvers** (unlike CoW Protocol). We found no one else building this on Monad (checked Sep 2026).
- Batch auctions are a well-known answer to MEV in market-design research, so the judges will already know why this matters.

### 2. Clearly needs Monad
- The batch is one block, and Monad blocks are 300ms with 600ms finality. On Ethereum a batch would be 12s.
- Ready answer to "why not Solana?": Solana isn't EVM (no Solidity or EVM liquidity), it queues writes to shared accounts one after another, caps computation per transaction, and has traditionally taken ~12s to fully finalize.

### 3. Technical depth (the part most teams won't have)
- Price-level buckets: finding the clearing price costs the same no matter how many orders are in the batch
- Lazy claims: each user collects their fill with one cheap call
- **Designed for parallel execution:** buckets are split into K shards so orders don't all write the same storage slot. We benchmark K=1 against K=16
- Storage laid out around Monad's 128-slot storage pages
- Fuzz and invariant tests: funds are always conserved, and no order fills at a worse price than its limit

### 4. Demo that makes the point in 30 seconds
1. A bot sandwiches a swap on a normal AMM: the victim loses X%
2. The same attack on Metronome: the victim loses $0
3. Live chart: supply and demand clear every 300ms
4. One-tap trade on a phone

### 5. Ecosystem value
- MEV-protected trading for Monad tokens (MON/AUSD first)
- A public write-up on "writing contracts that run well in parallel on Monad" that other devs can reuse

## Risks
| Risk | Mitigation |
|---|---|
| Strong DeFi teams in this track | Win on novelty, depth and demo polish, not feature count |
| Bugs in the clearing math | Discrete ticks, one market, heavy fuzzing |
| No liquidity during the demo | Our own market-maker bot and seeded liquidity |
