# Metronome — Roadmap (Sep 25 → Oct 13, 2026)

Solo build. Design: [`architecture.md`](architecture.md). Submission target **Oct 12**; Oct 13 is buffer only.

## Milestones

| # | Date | Milestone | Done when |
|---|---|---|---|
| M0 | Sep 26 | Spec frozen, repo scaffolded | Foundry builds, CI runs `forge test`, mocks deployed locally |
| M1 | **Oct 1** | Core contract on testnet | place → settle → claim works on Monad testnet; fuzz + invariant tests green |
| M2 | Oct 3 | Live market | Keeper + MM bot running on testnet; SandwichLab shows victim loss AMM vs. 0 on Metronome |
| M3 | **Oct 7** | End-to-end on a phone | Privy login → fund → trade → auto-claimed, on a real phone, on testnet |
| M4 | Oct 9 | Sponsor integrations | CRE workflow settling on testnet (if supported); benchmark numbers collected |
| M5 | Oct 10 | Mainnet | Contracts verified on Monad mainnet (143), small seeded liquidity |
| M6 | **Oct 12** | Submitted | Video, README, project profile, all bounties opted in |

## Day-by-day

### Phase 1 — Foundations (Sep 25–26)
- [ ] Copy official sponsor rules from the dashboard into `tracks/` (Agora, Privy, Chainlink). **These decide phases 4–5.**
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
- [ ] Run keeper + MM + sandwich on testnet → M2 (**blocked: needs testnet AUSD**)

### Phase 4 — Frontend + Privy + Agora (Oct 4–7)
- [ ] Oct 4: Next.js scaffold, wagmi/viem, Privy provider, Monad chain config, Trade page ticket
- [ ] Oct 5: live batch chart (supply/demand), last prices, `/portfolio`
- [ ] Oct 6: Privy beyond login: embedded wallet, headless signing, smart wallet batching + gas sponsorship (if available), funding button; tight gas limits
- [ ] Oct 7: mobile polish, PWA manifest, `/batch/[id]`, `/lab`; test on a real phone → M3

### Phase 5 — Chainlink CRE + benchmark (Oct 8–9)
- [ ] Oct 8: CRE `metronome-heartbeat` workflow (simulate locally, then deploy)
- [ ] Oct 9: benchmark K=1 vs K=16 with 200 wallets; `/stats` page → M4

### Phase 6 — Ship (Oct 10–12)
- [ ] Oct 10: security self-review (checklist in architecture §7), mainnet deploy + verify, seed liquidity → M5
- [ ] Oct 11: README (problem, why Monad, diagram, addresses, test + gas + benchmark results, how to run); record the demo video
- [ ] Oct 12: submit; opt in to bounties → M6
- Oct 13: buffer only. No new features.

## What each track needs, and when it's ready

| Track / bounty | Must-have for submission | Built in | Ready by |
|---|---|---|---|
| **Track 01** | Onchain matching contract, tests, live market, sandwich demo | Phases 2–3 | Oct 3 |
| **Grand Champion** | Polish, numbers (`/stats`), `IMetronome` integration guide, strong README + video | Phases 5–6 | Oct 11 |
| **Agora (mobile, AUSD)** | AUSD quote asset, mobile PWA, filmed on a phone | Phases 2 + 4 | Oct 7 |
| **Privy ($5k)** | Embedded wallet + headless signing + funding (+ smart wallet batching if available) | Phase 4 | Oct 6 |
| **Chainlink CRE ($3k)** | Workflow that settles batches on Monad | Phase 5 | Oct 8 |

## If we fall behind: what gets cut, in order

1. Smart-wallet batching and gas sponsorship (keep embedded wallet + headless signing)
2. Mainnet deploy (submit on testnet; allowed, just less impressive)
3. Chainlink CRE workflow (−$3k chance)
4. Benchmark (keep the design explanation, drop the chart)
5. `/batch/[id]` and `/stats` pages

**Never cut:** the core contract and its tests, the sandwich demo, a working mobile trade, and the video.

## Risks to watch

| Risk | Early signal | Response |
|---|---|---|
| Clearing math bugs | Differential fuzz fails | Stop and fix before anything else; it's the whole product |
| CRE can't write to Monad | Found out in Phase 1 | Drop the bounty; keeper does the job |
| No Chainlink feed on Monad | Found out in Phase 1 | Oracle guard stays off; MM uses last clearing price or an offchain price |
| Privy smart wallets not on Monad | Found out Oct 6 | Cut item 1 above |
| Agora needs a native app | Found out in Phase 1 | Capacitor wrapper on Oct 7 (half a day) |
| RPC log-range limits break the frontend | Oct 5 | Smaller windows; cache in the browser |
| Monad testnet unstable near the deadline | Oct 10+ | Record the video early (Oct 11), keep a local Anvil demo as backup |
