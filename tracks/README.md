# Where Metronome is applying

Metronome is a fully onchain **frequent batch auction** exchange on Monad. Every block, all orders clear at one uniform price, so front-running and sandwiching don't work.

| # | Prize | Amount | Integration (audited Oct 6) | What is still missing | File |
|---|---|---|---|---|---|
| 1 | **Track 01 — Onchain Finance & Trading** (main) | $10k (1 of 3 winners, from $30k) | ✅ **Full** on testnet: contracts (112 tests), app, keeper/MM/taker bots, local e2e | Mainnet deploy (needs ~3 MON from the user), hosted app URL, demo video | [01-onchain-finance-and-trading.md](01-onchain-finance-and-trading.md) |
| 2 | **Grand Champion** (all tracks) | $25k | Auto-considered | Same as #1 | [grand-champion.md](grand-champion.md) |
| 3 | **Agora — Best Mobile Trading App** | $10k | ✅ **Full** on testnet: Mera passkey → AUSD balance + faucet → Perpl trade (official rules copied) | Film on a real phone; open question whether a PWA counts as a "mobile application" | [bounty-agora-mobile-trading.md](bounty-agora-mobile-trading.md) |
| 4 | **Perpl — Best use of Perpl's API** | $5k | 🟡 **Partial**: market data over Perpl's REST API, account + trades on Perpl's exchange contract, pasted API key checked with a signed request | In-app API-key enrollment and order entry over the API (blocked on Perpl whitelisting our origin) | [bounty-perpl.md](bounty-perpl.md) |
| 5 | **Mera — Best Mera-Powered UX** | $2.5k | ✅ **Full**: Face ID login, popup-free signing | Real-phone test | [bounty-mera.md](bounty-mera.md) |
| 6 | **Mera — One Passkey, Many Keys** | $2.5k | ✅ **Full**: one passkey → wallet, sub-accounts, Perpl Ed25519 key, device vault key | — | [bounty-mera.md](bounty-mera.md) |
| 7 | **Nansen — Best use of Nansen** (MEV radar) | $5k | 🟡 **Partial**: `/radar` on mainnet data from Nansen DEX trades + first funders | Labels skipped (credit cost on the free plan); radar is a snapshot (`pnpm radar`), not live | [bounty-nansen.md](bounty-nansen.md) |
| 8 | **Chainlink — Best CRE workflow** | $3k | ✅ **Full via simulation**: settle + MON/USD reports written on testnet with `simulate --broadcast` (accepted by the rules) | Deploy on Chainlink's network (deploy access "Not enabled", only Chainlink can switch it on) | [bounty-chainlink-cre.md](bounty-chainlink-cre.md) |
| 9 | **Envio — Best Use of Envio** (indexer) | $1k | 🟡 **Partial for the live demo**: indexer runs on testnet in Docker on this machine; Stats + portfolio history use it | A public indexer URL (`NEXT_PUBLIC_INDEXER_URL`) for the hosted app, otherwise `/stats` says "not configured" | [bounty-envio.md](bounty-envio.md) |

Legend: ✅ full = everything the bounty asks for runs; 🟡 partial = submittable, but part of the integration depends on someone else (sponsor whitelist, credits, hosting).
Sponsor rules for #4–9 are still "TBC" in their files (only on the logged-in dashboard); Agora's and Chainlink's key rules are copied.

**Maximum if everything lands: $64k.** Items 3–6 share one piece of work (Mera login + Perpl perps tab), Perpl's origin whitelist only gates in-app API-key enrollment; trading works without it (decision Oct 4 in bounty-perpl.md).

**Cash prizes only.** We skip any prize paid in credits, hosting or plans: Alchemy, Mercuryo, Chainstack, Crouton, Zerion, Spectrum Nodes, ack3, and Envio's winners-only hosting perk (its $1k all-teams bounty is cash and is item 9).
Before submitting, confirm on the dashboard that items 3–9 are paid in cash.

**Dropped (Sep 26):** Privy ($5k). Mera replaces it for login (the Agora bounty requires Mera). Notes kept in [bounty-privy.md](bounty-privy.md).

**Not targeting:**

| Bounty | Why |
|---|---|
| Kuru ×2 ($5k each) | Built on Kuru's exchange, which competes with Metronome |
| Perpl — Best Analytics / Risk Tool ($3k) | A separate product |
| Dynamic ($5k) | Login/wallet provider; we use Mera |
| Cleanverse ($2k) | Identity/compliance tokens; no fit for an exchange |
| Aurora Intents ($5k), MetaMask ($2.5k) | Cross-chain intents / agent wallet plugin; unrelated |
| Monad Foundation Community Team ($5k) | For community teams; we're solo |

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
- [ ] Track 01 selected; Agora, Perpl, Mera ×2, Nansen, Chainlink and Envio bounties opted in (if opt-in is required)
- [ ] Contracts deployed and verified on Monad explorer, with addresses in the README
- [ ] Live frontend URL works on mobile
- [ ] Demo video (2–3 min): sandwich-attack comparison, live batch clearing, mobile trade, parallelism benchmark
- [ ] README: problem, why Monad, architecture diagram, how to run, test results
- [ ] Tests passing (unit, fuzz, invariant) with coverage shown in the README
