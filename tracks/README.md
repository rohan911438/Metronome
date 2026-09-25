# Where Metronome is applying

Metronome is a fully onchain **frequent batch auction** exchange on Monad. Every block, all orders clear at one uniform price, so front-running and sandwiching don't work.

| # | Prize | Amount | Status | File |
|---|---|---|---|---|
| 1 | **Track 01 — Onchain Finance & Trading** (main) | $10k (1 of 3 winners, from $30k) | Applying | [01-onchain-finance-and-trading.md](01-onchain-finance-and-trading.md) |
| 2 | **Grand Champion** (all tracks) | $25k | Auto-considered | [grand-champion.md](grand-champion.md) |
| 3 | **Agora — Best Mobile Trading App** | Part of Agora's $20k | Applying (rules TBC) | [bounty-agora-mobile-trading.md](bounty-agora-mobile-trading.md) |
| 4 | **Privy — Integration bounty** | $5k | Applying (rules TBC) | [bounty-privy.md](bounty-privy.md) |
| 5 | **Chainlink — Best CRE workflow** | $3k | Applying (rules TBC) | [bounty-chainlink-cre.md](bounty-chainlink-cre.md) |
| 6 | **Envio — Indexer** | $5k in free hosting (credits) | Applying (rules TBC) | [bounty-envio.md](bounty-envio.md) |
| 7 | **Alchemy — Platform credits** | $1k in credits | Applying (rules TBC) | [bounty-alchemy.md](bounty-alchemy.md) |

**Stretch goal:** Mercuryo ($10k in credits and support), adding a "Buy AUSD with card" button in the mobile app, only if time allows in the last days.

**Not targeting:** Kuru (competing exchange), Perpl (perps tools), Nansen and Aurora Intents (weak fit), Dynamic (does the same job as Privy).

> One project normally enters **one** main track. Sponsor bounties stack on top of it, so that's where the extra chances come from.

> **TBC** means the exact sponsor rules are only on the logged-in dashboard at https://hackathon.monad.xyz.
> Before building each integration, copy the official wording into that file.

---

## Hackathon-wide eligibility (applies to everything above)

Source: https://monad.xyz/developers/hackathons/metropolis

| Rule | How we meet it |
|---|---|
| Build window **Sep 1 – Oct 13, 2026**; judges check that work was done in the window | Repo created Sep 25, 2026. Every commit is timestamped. No prior code |
| Existing projects are allowed only if the submitted work is new | 100% new build |
| Submit a **working product** | Deploy to Monad (testnet 10143, then mainnet 143 if stable) with a live frontend URL |
| **Public project profile** with **demo**, **written description**, **code access** | Public GitHub repo, 2–3 min demo video, this README plus docs |
| Solo or team | Solo builder |
| Open source encouraged, not required | Repo is public |
| Region restrictions are listed on the platform | TBC: check the dashboard |

## Key dates

| Date | What |
|---|---|
| **Oct 13, 2026** | Submission deadline. **Our target is Oct 12** |
| Oct 14 – 27 | Judging |
| Nov 3 | Winners announced |

## Submission checklist

- [ ] Registered on hackathon.monad.xyz and project profile created
- [ ] Track 01 selected; Agora and Privy bounties opted in (if opt-in is required)
- [ ] Contracts deployed and verified on Monad explorer, with addresses in the README
- [ ] Live frontend URL works on mobile
- [ ] Demo video (2–3 min): sandwich-attack comparison, live batch clearing, mobile trade, parallelism benchmark
- [ ] README: problem, why Monad, architecture diagram, how to run, test results
- [ ] Tests passing (unit, fuzz, invariant) with coverage shown in the README
