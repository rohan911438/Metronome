# Nansen — Best use of Nansen ($5,000 cash)

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here before building.
> Public hints only: other teams' repos describe it as using `NANSEN_API_KEY` to enrich addresses with Nansen labels and smart-money tags.

## Open questions (ask in the Nansen Discord channel)
- [ ] Does the Nansen API cover **Monad** (mainnet 143)? Which endpoints (labels, profiler, token flows)?
- [ ] Is there a free API key or credits for hackathon teams?
- [ ] Anything mandatory (a specific endpoint, Nansen MCP / AI agent, attribution)?

## What we build: MEV radar (`/radar`)

Metronome's pitch is "sandwiches don't work here". The lab proves it on our own contracts; the radar shows the problem **on real Monad markets**, with Nansen telling us who the attackers are.

| Step | How |
|---|---|
| 1. Find sandwiches | `bots/src/radar.ts` scans swap events of the busiest Monad mainnet AMM pools over a recent block window and flags the pattern *A buys → V buys → A sells* inside one block (same pool, same attacker address or contract) |
| 2. Measure the damage | Victim loss = what V paid minus what V would have paid without A's front-run (replay against the pool's reserves), in USD |
| 3. Label with Nansen | Attacker and victim addresses go to the Nansen API: entity labels (e.g. known MEV bot), smart-money tags, and the attacker's overall P&L where available |
| 4. Show it | `/radar` page: total extracted, number of victims, top attackers with their Nansen labels, and "the same trade on Metronome: 0 loss" next to each case |

- The API key stays server-side: the scan runs as a script (output: `web/public/radar.json`, refreshed on demand) or a Next.js route handler that reads `NANSEN_API_KEY`. It never reaches the browser.
- Monad mainnet data only; testnet has too little organic flow to find real sandwiches.

## Fallback if Nansen doesn't cover Monad
Label the attacker addresses' activity on chains Nansen does cover (many MEV operators reuse addresses across EVM chains), and say plainly in the write-up which chain the labels come from. If that's not allowed either, drop this bounty.

## How we plan to win
- Real numbers from real Monad users, not a synthetic demo
- Nansen is central to the page (who is doing this to users), not a sidebar
- The page closes the loop: here's the loss on today's venues → here's the same trade on Metronome
