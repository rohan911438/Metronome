# Metronome — Roadmap (Sep 25 → Oct 13, 2026)

Solo build. Design: [`architecture.md`](architecture.md). Submission target **Oct 12**; Oct 13 is buffer only.

## Milestones

| # | Date | Milestone | Done when |
|---|---|---|---|
| M0 | Sep 26 | Spec frozen, repo scaffolded | Foundry builds, CI runs `forge test`, mocks deployed locally |
| M1 | **Oct 1** | Core contract on testnet | place → settle → claim works on Monad testnet; fuzz + invariant tests green |
| M2 | Oct 3 | Live market | Keeper + MM bot running on testnet; SandwichLab shows victim loss AMM vs. 0 on Metronome |
| M3 | **Oct 7** | End-to-end on a phone | Mera passkey login → AUSD balance → Metronome trade (auto-claimed) **and** a Perpl perp trade, on a real phone |
| M4 | Oct 10 | Sponsor integrations | CRE workflow settling on testnet (if supported); Envio indexer live behind `/stats`; `/radar` shows real Monad sandwiches with Nansen labels; benchmark numbers collected |
| M5 | Oct 11 | Mainnet | Contracts verified on Monad mainnet (143), small seeded liquidity |
| M6 | **Oct 12** | Submitted | Video, README, project profile, all bounties opted in |

## Day-by-day

### Phase 1 — Foundations (Sep 25–26)
- [x] Agora rules copied (Sep 26): Mera passkey login + AUSD balance + trades through Perpl. **Decision: switch login from Privy to Mera, add a Perpl perps tab; Privy dropped**
- [ ] Copy the remaining official sponsor rules into `tracks/`: Perpl, Mera ×2, Nansen, Chainlink, Envio. **These decide phases 4–5.**
- [ ] Ask the Perpl team (user): whitelist our origin for API-key enrollment; testnet "USD" collateral; is the testnet beta open
- [ ] Ask Agora (user): is a Perpl testnet trade OK for the demo, or must it be mainnet AUSD?
- [ ] Ask Nansen (user): does the API cover Monad; free hackathon key?
- [x] Get testnet MON from the faucet
- [x] Find the testnet AUSD address and WMON address; check for a Chainlink MON/USD feed on Monad
- [x] `forge init contracts`, OpenZeppelin, `foundry.toml` with Monad testnet/mainnet RPCs
- [x] `TickMath.sol` + exhaustive test over all 4096 ticks
- [x] `TickBitmap.sol` + tests
- [x] Mocks: `MockERC20` (6 and 18 decimals), `MockAggregator`
- [x] GitHub Actions: `forge fmt --check`, `forge test`

### Phase 2 — Core contract (Sep 27–Oct 1)
- [x] Sep 27: `ClearingLib` (pure) + brute-force reference + differential fuzz
- [x] Sep 28: `placeOrder` with shards, escrow, per-user nonce IDs, events
- [x] Sep 29: `settle` (reads shards → clearing → result), oracle guard, keeper reward
- [x] Sep 30: `claim`, `claimMany`, `settleAndClaim`, fees, pause; unit tests for every path
- [x] Oct 1: invariant suite, gas numbers, `Deploy.s.sol` (dry-run against testnet passes)
- [x] **Deploy to testnet** → M1 ✅ (Sep 25, see `docs/network.md`)

### Phase 2b — Resting orders (added Sep 25)
- [x] Found that one-batch orders make market making cost ~0.8 MON/s on testnet; chose resting orders (per-price pools with share accumulators)
- [x] Contract, 16 resting unit tests, invariants extended (pools consistent, book never crosses); makers pay no fee
- [x] Redeployed to testnet (v2 `0x99E4…a889`); resting post → settle → cancel verified live

### Phase 3 — Bots and demo contracts (Oct 2–3)
- [x] pnpm workspace, shared `config.ts` (addresses from deployments JSON, ABIs generated from `forge build`)
- [x] Keeper: block watcher → `settleAndClaim`, resting harvests
- [x] MM bot: resting ladder, re-quote on price moves, inventory limits (single wallet for now)
- [x] Local end-to-end test (Anvil) in CI: 60 random takers, 55 filled, 0 bot errors
- [x] `MiniAMM.sol` + `SandwichLab.sol` (tests: AMM victim −4.17%, Metronome victim 0)
- [ ] Run keeper + MM + sandwich on testnet → M2. The AUSD faucet is empty, so: redeploy the testnet market as **WMON/USDC** (deployer holds 20 testnet USDC + 6.5 MON); mainnet stays WMON/AUSD. The AUSD balance Agora wants comes from the AUSD token (and Perpl collateral on mainnet), not the testnet market. **Waiting for the user's OK**
- [x] `pnpm dev:local`: long-running local stack (Anvil + deploy + keeper + MM + background traders + one lab run) for frontend work

### Phase 4 — Frontend + Mera (done Sep 26, ahead of schedule)
- [x] `web/`: Next.js 16 + viem + Tailwind, installable PWA (manifest, PNG/SVG icons, service worker); builds for local and testnet
- [x] Trade page: ticket ("Now" taker order with max price move, "Limit" resting order), auto wrap + approve, fill result card; live supply/demand chart; recent batches
- [x] `/portfolio` (orders found from `nonces(owner)`, no log scans; fills and refunds shown separately; cancel resting orders), `/batch/[id]`, `/lab` (live result + "run it yourself")
- [x] **Mera login replaced Privy:** create / unlock / lock / sign out; wallet key only in an in-memory Mera signing session; clear message on devices without PRF
- [x] **One passkey, many keys:** `lib/keys.ts` derives the Monad wallet (BIP-44) and the Perpl Ed25519 API key (HKDF, own label) from one PRF output; "One passkey, many keys" panel
- [x] AUSD balance in the header and account sheet; "Add AUSD/MON" (receive address; testnet faucet link)
- [x] CI job `web.yml`: generated files up to date, typecheck, testnet build
- [x] Validated in headless Edge at phone size against `pnpm dev:local`: 9/9 UI checks (fund, buy, sell, limit, portfolio + cancel, batch, lab run); passkey flow with a virtual PRF authenticator 5/5 (create, keys, lock/unlock and reload give the same address, trade with no popup); testnet build reads the live contract with no errors
- [ ] Test on a real phone (iOS 18+ / Android) with a real passkey → part of M3

### Phase 4b — Perpl perps tab (Oct 4–7)
- [x] Oct 4 (done Sep 26): `lib/perpl.ts` + `/perps` page: market picker (all open markets, MON first), mark/oracle price, 24h change, volume, open interest, funding, fees, candles (5m/1h/1d), live L2 book. Data comes through `app/api/perpl` (a cached pass-through for public REST paths only), because Perpl sends no CORS headers and its market-data WebSocket answers browser origins with 403. Validated in headless Edge at phone size against testnet: 11/11 checks
- [ ] Oct 5: onboarding signed by the Mera wallet: approve collateral → `createAccount` → `allowOrderForwarding(true)`; API-key enrollment (`/api-key/payload` → EIP-712 wallet signature + Ed25519 proof → `/api-key/enroll`). **Needs Perpl's origin whitelist**; fallback: paste a key made on perpl.xyz
- [ ] Oct 6: trading WebSocket: signed requests, place market/limit orders, cancel; positions, open orders, P&L, collateral in AUSD; perps section in `/portfolio`
- [ ] Oct 7: mobile polish; film on a real phone: passkey → AUSD balance → Metronome trade → Perpl trade → M3

### Phase 5 — Sponsor integrations + benchmark (Oct 8–10)
- [ ] **Oct 8 — Chainlink CRE:** `metronome-heartbeat` workflow (cron trigger → find pending batches → `settleAndClaim`); simulate locally, then deploy to testnet
- [ ] **Oct 9 — Envio indexer** (`indexer/`, HyperIndex): entities `Order`, `Batch`, `Trader`, `Pool`, `Keeper`, `DailyStats` from `OrderPlaced`, `BatchSettled`, `Claimed`, `OrderCancelled`, `PoolUpdated`, `SettleRewardPaid`; run locally against Anvil, then host for testnet (Envio Cloud)
- [ ] **Oct 9 — `/stats` page** from the indexer (volume, batches, trades, traders, fill time, gas per action, keeper leaderboard, clearing-price chart); portfolio history from the indexer with RPC fallback
- [ ] **Oct 10 — Nansen MEV radar:** `bots/src/radar.ts` scans the busiest Monad mainnet AMM pools for same-block sandwiches and computes each victim's loss; labels attackers/victims via the Nansen API (key server-side only); writes `radar.json`; `/radar` page
- [ ] **Oct 10 — benchmark** K=1 vs K=16 with 200 wallets; results on `/stats` → M4

### Phase 6 — Ship (Oct 11–12)
- [ ] Oct 11: security self-review (checklist in architecture §7, incl. a fork test against real WMON/AUSD), mainnet deploy + verify, seed liquidity, point the indexer and app at mainnet → M5
- [ ] Oct 11: if Agora needs mainnet: fund a demo account with ≥100 AUSD + MON (user), do the Perpl mainnet trade on camera
- [ ] Oct 11: record the demo video (early, in case testnet/mainnet is unstable later)
- [ ] Oct 12: README (problem, why Monad, diagram, addresses, tests, gas, benchmark, radar findings, indexer GraphQL example, Mera keys, Perpl flow, how to run); submit; opt in to Agora, Perpl, Mera ×2, Nansen, Chainlink, Envio → M6
- Oct 13: buffer only. No new features.

## What each track needs, and when it's ready

| Track / bounty | Must-have for submission | Built in | Ready by |
|---|---|---|---|
| **Track 01** | Onchain matching contract, tests, live market, sandwich demo | Phases 2–3 | Oct 3 |
| **Grand Champion** | Polish, numbers (`/stats`), `IMetronome` integration guide, strong README + video | Phases 5–6 | Oct 11 |
| **Agora ($10k)** | Mobile app: Mera passkey login, AUSD balance, a trade through Perpl, filmed on a phone | Phases 4–4b | Oct 7 |
| **Perpl ($5k)** | Perps tab: in-app onboarding, API-key enrollment, orders over the trading WebSocket | Phase 4b | Oct 7 |
| **Mera ×2 ($2.5k each)** | Passkey login with popup-free signing; one passkey derives the wallet key and the Perpl API key | Phase 4 | Oct 3 |
| **Chainlink CRE ($3k)** | Workflow that settles batches on Monad | Phase 5 | Oct 8 |
| **Envio ($1k)** | HyperIndex indexer used by `/stats` and portfolio history | Phase 5 | Oct 9 |
| **Nansen ($5k)** | `/radar`: real Monad sandwiches, attackers labelled via the Nansen API | Phase 5 | Oct 10 |
| ~~Privy~~ | Dropped Sep 26 (replaced by Mera) | — | — |

## If we fall behind: what gets cut, in order

1. Mera sub-accounts (keep the wallet key + Perpl key)
2. Benchmark (keep the design explanation, drop the chart)
3. Envio indexer and `/stats` (−$1k chance; the app already runs on RPC alone)
4. Mainnet deploy (submit on testnet; allowed, just less impressive; the radar still reads mainnet)
5. Chainlink CRE workflow (−$3k chance)
6. Nansen radar (−$5k chance)
7. `/batch/[id]` page

If Perpl never whitelists our origin: keep the perps tab with the "paste a key from perpl.xyz" fallback rather than cutting it (Agora and Perpl both need the trade).

**Never cut:** the core contract and its tests, the sandwich demo, Mera login, a working mobile trade on Metronome and on Perpl, and the video.

## Risks to watch

| Risk | Early signal | Response |
|---|---|---|
| Clearing math bugs | Differential fuzz fails | Stop and fix before anything else; it's the whole product |
| CRE can't write to Monad | Found out in Phase 1 | Drop the bounty; keeper does the job |
| No Chainlink feed on Monad | Found out in Phase 1 | Oracle guard stays off; MM uses last clearing price or an offchain price |
| Perpl doesn't whitelist our origin in time | Ask now (Sep 26); decide by Oct 5 | Paste-a-key fallback; say so in the write-up |
| No Perpl testnet collateral / closed beta | Ask now | Do the Perpl trade on mainnet with real AUSD (≥100, user funds) |
| Device lacks passkey PRF support | First phone test | Test on iOS 18+ / recent Android + Chrome early; show a clear "unsupported device" message |
| Agora requires mainnet AUSD | Ask now | Mainnet Perpl trade on Oct 11 |
| Nansen API doesn't cover Monad, or no hackathon key | Ask in Nansen Discord now | Label cross-chain addresses and say so; otherwise drop the bounty |
| Few real sandwiches on Monad mainnet | Radar scan on Oct 10 (run a trial scan earlier) | Widen the block window and pool list; report honestly, e.g. "N sandwiches, $X extracted in 7 days" |
| Envio doesn't support Monad | Check docs before Oct 9 | Drop the bounty; `/stats` from RPC over a short window |
| Low RAM on the dev machine (installs killed) | Sep 26 | Close other apps before installs/builds; avoid running dev server, Anvil and bots all at once |
| RPC log-range limits break the frontend | Oct 5 | Smaller windows; cache in the browser |
| Monad testnet unstable near the deadline | Oct 10+ | Record the video early (Oct 11), keep a local Anvil demo as backup |
