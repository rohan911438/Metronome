# Phase verification

Checked **Sep 25, 2026 (21:50)** against commit `3d73acf` and the [roadmap](roadmap.md) phases. Each item was re-run or re-read, not taken on trust from the checkboxes.

Legend: ✅ verified · ⚠️ done, with a gap · ❌ not done · 🧪 **mock / stub / simulated**: must be replaced or reviewed before submission

## How it was checked

| Check | Result |
|---|---|
| `forge fmt --check` | ✅ passes |
| `forge build --sizes` on a clean checkout of `3d73acf` | ✅ compiles; Metronome runtime = **15,389 bytes** (limit 24,576) |
| `forge test` on a clean checkout of `3d73acf` | ✅ **67 passed, 0 failed**, 7 suites, ~2 min |
| GitHub Actions (`contracts` workflow) on `3d73acf` | ✅ success (run 36159560736) |
| Deployed bytecode size vs. local build | ✅ both 15,389 bytes |
| Deployed config read over RPC (`cast call`) | ✅ matches `contracts/deployments/10143.json` |

> ⚠️ **The working tree does not build right now.** The untracked Phase 3 files (`src/demo/`, `test/SandwichLab.t.sol`) fail with *Stack too deep* at `src/demo/SandwichLab.sol:115`. That's why the checks above ran on a clean copy of the last commit. See Phase 3.

---

## Phase 1: Foundations

| Item | Status | Evidence |
|---|---|---|
| Copy official sponsor rules into `tracks/` | ❌ | Agora, Privy and Chainlink files still say "Official requirements are TBC" |
| Testnet MON from faucet | ✅ | Deployer `0x0D35…2373` holds ~2.46 MON |
| Testnet AUSD + WMON addresses; Chainlink MON/USD feed check | ✅ | AUSD/WMON have code and match `docs/network.md`. No Chainlink push feed on Monad; Pyth found |
| Foundry project, OZ, RPCs in `foundry.toml` | ✅ | Solc 0.8.28, `prague`, optimizer 1000 runs |
| `TickMath.sol` + exhaustive test over 4096 ticks | ✅ | `TickMath.t.sol` passes |
| `TickBitmap.sol` + tests | ✅ | `TickBitmap.t.sol` passes (fuzzed) |
| Mocks: `MockERC20`, `MockAggregator` | ✅ 🧪 | Present, test-only (see Mocks) |
| CI: fmt + test | ✅ | Workflow green |
| M0: "mocks deployed locally" | ⚠️ 🧪 | Mocks are only deployed inside tests. `Deploy.s.sol` can't deploy them on Anvil (chain 31337 needs `BASE_TOKEN`/`QUOTE_TOKEN` set). Matters for the "local Anvil backup demo" in the risk table |

## Phase 2: Core contract

| Item | Status | Evidence |
|---|---|---|
| `ClearingLib` + brute-force differential fuzz | ✅ | `ClearingLib.t.sol` passes (1000 fuzz runs; 5000 in CI) |
| `placeOrder`: shards, escrow, nonce IDs, events | ✅ | `Metronome.t.sol` (35 tests) passes |
| `settle`: clearing, oracle guard, keeper reward | ✅ ⚠️ 🧪 | Logic tested, but the oracle guard is only tested against `MockAggregator`, and it's **off** on testnet |
| `claim`, `claimMany`, `settleAndClaim`, fees, pause | ✅ | Unit tests pass |
| Invariant suite | ✅ 🧪 | 256 runs × 100 calls pass, but only with `MockERC20` tokens |
| Gas numbers | ✅ ⚠️ | `Gas.t.sol` uses Foundry's **Ethereum** gas schedule. Real Monad numbers are ~2–4× higher (in `network.md`) |
| `Deploy.s.sol` | ✅ | `Deploy.t.sol` passes; deployment JSON written |
| **Deploy to testnet (M1)** | ✅ ⚠️ | Live at `0xd9eD8A732D8daE96855b40e1ebD65E9d36583ea1` (see below). Gap: **no real trade on testnet yet** |

### Live testnet state (read Sep 25)

| Field | On-chain | Expected |
|---|---|---|
| `BASE` | `0xFb8b…C541` (WMON) | ✅ |
| `QUOTE` | `0xa901…22dC` (AUSD) | ✅ |
| `SHARDS` | 16 | ✅ |
| `PRICE_MIN` | 3228117476499511058185 | ✅ matches JSON |
| `MIN_ORDER_SIZE` | 1e18 (1 MON) | ✅ |
| `feeBps` / `settleReward` | 5 / 0 | ✅ script defaults |
| `oracle.feed` | `0x0` | ⚠️ guard **disabled** |
| `paused` | false | ✅ |
| Contract WMON / AUSD balance | 0 / 0 | ✅ smoke test fully refunded |
| `lastSettledBatch` | 0 | ⚠️ only set when volume > 0, so **no batch has ever cleared with volume** on testnet |

## Phase 3: Bots and demo contracts (in progress, uncommitted)

| Item | Status | Evidence |
|---|---|---|
| pnpm workspace + shared `config.ts` | ❌ | No `package.json` in the repo |
| Keeper (block watcher → `settleAndClaim`) | ❌ | Not started |
| MM bot (ladder, 3 wallets, inventory limits) | ❌ | Not started |
| `MiniAMM.sol` | ⚠️ 🧪 | Written, untracked. Demo-only x*y=k pool, no LP shares |
| `SandwichLab.sol` + test | ❌ 🧪 | Written, untracked, **does not compile** (Stack too deep, line 115). Test never ran |
| Sandwich script → M2 | ❌ | Not started |

## Phases 4–6: Frontend, CRE + benchmark, ship

❌ Not started (as planned; they're scheduled for Oct 4–12).

---

## Mocks, stubs and placeholders to fix later

| # | What | Where | Why it's a mock | Fix | Before |
|---|---|---|---|---|---|
| 1 | `MockERC20` stands in for WMON and AUSD in every unit and invariant test | `src/mocks/MockERC20.sol`, `test/Metronome.t.sol`, `test/invariant/` | Real AUSD may behave differently (e.g. blacklist/pause hooks) | Add a fork test against real testnet WMON/AUSD (`vm.createSelectFork`) | Oct 10 (security review) |
| 2 | `MockAggregator` is the only price feed ever tested | `src/mocks/MockAggregator.sol`, `Metronome.t.sol:552` | No Chainlink MON/USD feed on Monad; guard is off on-chain | Wire up Pyth's Chainlink-compatible adapter and call `setOracle`, or document the guard as off | Oct 10 |
| 3 | Oracle guard disabled on the live deployment | `oracle.feed = 0x0` | Placeholder config | Same as #2 | Oct 10 |
| 4 | No real trade on testnet: only a 0-volume smoke test | Live contract | AUSD faucet empty, deployer holds 0 AUSD | Get AUSD from Agora/hackathon, then run a crossed buy+sell | Oct 3 (M2) |
| 5 | Gas figures in `contracts/README.md` use the Ethereum schedule | `test/Gas.t.sol` | Not Monad pricing | Lead with measured Monad numbers in the README and pitch | Oct 11 |
| 6 | `settleReward = 0` on testnet | Deploy config | No keeper incentive yet | Set once the keeper runs and fees accrue | Oct 3 |
| 7 | `MiniAMM`: toy AMM with no LP shares | `src/demo/MiniAMM.sol` | Demo stand-in for a real DEX | OK for the demo; label it clearly in the UI/video. Optionally compare against a real Monad AMM pool | Oct 11 |
| 8 | `SandwichLab` plays attacker, victim and maker itself | `src/demo/SandwichLab.sol` | Simulated attack, not a real mempool searcher | OK for the demo; say so in the README. Fix the compile error first | Oct 3 |
| 9 | No local mock deployment for an Anvil backup demo | `script/Deploy.s.sol` | Chain 31337 path needs token addresses | Add an Anvil branch that deploys `MockERC20`s + mints | Oct 11 |
| 10 | Mainnet WMON address is TBC | `docs/network.md`, `Deploy.s.sol:60` | Placeholder | Find and verify it before mainnet deploy | Oct 10 (M5) |
| 11 | Sponsor rules TBC (Agora, Privy, Chainlink) | `tracks/` | Placeholder text | Paste the official wording from the dashboard | Before Phase 4 (Oct 4) |

## Next actions, in order

1. Fix *Stack too deep* in `SandwichLab.sol:115` (e.g. move the emit into a helper or pack values into a struct), run `SandwichLab.t.sol`, then commit Phase 3 contracts.
2. Get testnet AUSD so a real trade can clear (#4); M2 depends on it.
3. Keeper + MM bot.
4. Paste the sponsor rules (#11) before starting Phase 4.
