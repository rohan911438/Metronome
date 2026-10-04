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
- [x] Nansen covers Monad (`chain: "monad"`); the user's key is on the free plan (100 trial credits, then 10 a day). Labels cost 100 credits, so the radar uses 1-credit endpoints
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
- [x] Testnet market redeployed as **WMON/USDC** (Sep 26, `0x32f1…3761`; mainnet stays WMON/AUSD); keeper + MM + `pnpm taker` ran live: 3 fills between two wallets (see `docs/network.md`)
- [x] Oct 3: testnet market redeployed as **WMON/tAUSD** (`0x753C…cF24`) on our open-mint `TestAUSD` (`0xA89C…d091`, ≤10M per mint; the Monad team's suggestion since Agora's faucet is empty); app has a "Mint 1,000 tAUSD" button; taker sold 1 MON into the MM's bid live
- [x] Oct 3 (later): Agora's AUSD faucet is refilled (10k AUSD per request, one a minute). Testnet market back on the original **WMON/AUSD** v2 (`0x99E4…a889`, same code); app button "Get 10,000 AUSD" calls the faucet; tAUSD retired. The market maker centers on the CRE MON/USD price when it's fresh
- [x] Oct 4: SandwichLab + MiniAMM on testnet (rest of M2) on their own tWMON/tAUSD lab market (a run moves 200k MON): live run −5.27% for the AMM victim vs 0% on Metronome; `/lab` mints test tokens and runs it from the passkey wallet (fork-tested in headless Edge)
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
- [x] Oct 5 (done Sep 26): Perpl account card on `/perps`, signed by the Mera wallet: approve exactly the deposit → `createAccount` → `allowOrderForwarding(true)`, resumable, with explicit states (not signed in / wrong network / **"100 AUSD required to activate Perpl trading on testnet"** / ready / account open). Paste-a-key fallback: key encrypted with a passkey-derived AES key before it touches localStorage; checked with a signed `GET /v1/trading/wallet`. `pnpm perpl:fork` runs the app against a local fork of testnet with a "Get test funds" button, so the real transactions run against Perpl's real contract. Validated in headless Edge: setup 17/17 (account #712 with 150 AUSD, forwarding event, zero leftover allowance), passkey key storage 10/10
- [x] Real testnet run of the Perpl account setup (Oct 3): from a passkey wallet in the app (headless Edge, virtual passkey): Perpl account #792 opened with 150 AUSD ([approve](https://testnet.monadscan.com/tx/0x59800065fd8024e31451a1cc008a26439c50acab5143ce4ac15fb4670225a49a), [createAccount](https://testnet.monadscan.com/tx/0xd224f5c33e36e3ec7a3d7647dcb0fcf25da4f0fe77653f5faa052f91714efdac), [forwarding](https://testnet.monadscan.com/tx/0xc9768b6332e649bc90b88b41c52a7cdb811708bb914ece27ea6a364d0f53edf0)); [long 1,000 MON at 2×](https://testnet.monadscan.com/tx/0xc54e2ccb0a1465f5ff692b48b14370c1117e86527937e396185c1cebac73cc3d) filled at 0.03132 and was [closed](https://testnet.monadscan.com/tx/0x4a1001261ea5f8b4fa26e00aa6bb45ae14830575e61aa87515a97b29f30d841a); a [short of 500 MON](https://testnet.monadscan.com/tx/0x5698100ce177657c7695c5c6b785cbab91a2b449ddd0701564f8e6bf08b2cd9a) filled at 0.03125
- [ ] In-app API-key enrollment (`/api-key/payload` → EIP-712 wallet signature + Ed25519 proof → `/api-key/enroll`) with the passkey-derived key: **needs Perpl's origin whitelist**
- [x] Oct 6 (done Oct 3): **trading on-chain, no API key needed**: `lib/perpl-trade.ts` + Trade card on `/perps`: long/short at market (immediate-or-cancel `execOrder` at best price ±1% cap), size, leverage 1/2/3/5×, margin check against the account balance, open position (side, size, entry, mark, P&L, margin) with one-tap close. Live on testnet (see above). On a fork Perpl's oracle price goes stale after 60 s (`0x7d19aaec`), so trading there only works right after the fork starts; the app says so
- [ ] Trading over Perpl's API/WebSocket with the passkey-derived key: needs the origin whitelist (the on-chain path above covers trading meanwhile); open orders and a perps section in `/portfolio`
- [ ] Oct 7: mobile polish; film on a real phone: passkey → AUSD balance → Metronome trade → Perpl trade → M3

### Phase 5 — Sponsor integrations + benchmark (Oct 8–10)
- [x] **Oct 8 — Chainlink CRE (done Sep 29):** `cre/metronome-heartbeat` (Go): cron → `nextPendingBatch()` → signed report → forwarder → `MetronomeHeartbeat.onReport` → `settle`. Receiver live on testnet, 7 Foundry + 4 Go tests, `simulate --broadcast` settled a real pending batch on testnet
- [x] Oct 3: CRE workflow fetches MON/USD from an external API (Coinbase, DON median) and the receiver stores it as an `IAggregatorV3` feed for the oracle guard (the bounty requires an external API); price-only and settle + price reports live on testnet
- [ ] CRE deploy (optional: the bounty accepts simulation and Chainlink deploys simulated hackathon workflows): deploy access still "Not enabled" on Oct 3; then `cre workflow deploy` and `setForwarder` to the real forwarder
- [x] **Envio indexer** (done Sep 26): `indexer/`, HyperIndex 3.13 in Docker (Envio has no Windows build) with Postgres + Hasura; entities `Stats`, `DailyStats`, `Batch`, `Order`, `Trader`, `Keeper`, `Pool`, `GasTx`. Runs against the local Anvil stack; totals match raw chain logs exactly. CI job `indexer.yml` (codegen + typecheck for both configs)
- [ ] Indexer on testnet: needs an Envio API token (free, envio.dev) or Envio Cloud, and trading activity on the testnet market (M2)
- [x] **`/stats` page** (done Sep 26): volume, batches, orders, traders, order-to-settlement delay, gas per action, keeper leaderboard, clearing-price chart, daily volume; live from the indexer, explains itself when no indexer is configured. Validated in headless Edge: 11/11
- [ ] Portfolio history from the indexer with RPC fallback
- [x] **Nansen MEV radar (done Oct 3):** `pnpm radar` (`bots/src/radar.ts`): Nansen `tgm/dex-trades` (1 credit per 1,000 WMON trades, with trader labels) → sandwich candidates (same wallet buys and sells around another trade within 2 s) → verified on Monad mainnet by block and transaction index → bot share of flow, Nansen first funders → `web/public/radar.json` → `/radar` page (linked from the Lab). First run: 5,000 WMON trades over 5.6 h on Oct 3 ($723k): 5 bot wallets made 75% of trades and 68% of volume (the top one alone 40%); 18 sandwich-shaped patterns, 0 verified on-chain (never front → victim → back in one block). 9 credits per run
- [x] **Benchmark** K=1/4/16 with 200 wallets (done Sep 26, [docs/benchmark.md](benchmark.md)): sharding cuts Metronome's conflict chain 24 → 10, but escrow `transferFrom` into one exchange balance keeps the whole-tx chain at ~100 for any K, and K=16 costs 3.2× settle gas
- [ ] Decide mainnet K (small K recommended while escrow is in the hot path); consider internal per-user balances to take escrow out of the shared slot

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
