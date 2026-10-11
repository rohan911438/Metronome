# Demo guide: using Metronome and recording the video

**Live app:** https://metronome-monad.vercel.app (Monad testnet). Use only this URL: passkeys are bound to the domain,
and the longer `…-rohans-projects-….vercel.app` links sit behind Vercel's login.

## 1. What is running (demo setup, Oct 11)

| Piece | Where | Notes |
|---|---|---|
| Web app (Next.js PWA) | Vercel project `metronome`, root `web/`, auto-deploys `main` | `NEXT_PUBLIC_NETWORK=testnet` |
| Keeper (settles every batch, pays orders out) | Render free web service `metronome-keeper`, [`/health`](https://metronome-keeper.onrender.com/health) | Sleeps when idle; the open app pings it and it starts settling within ~1 min |
| Keeper wallet | `0xF017E98A274897F499eE8D53D08C50D3Da521eAB` | Pays settle gas |
| New-user faucet (`/api/faucet`) | Vercel route, sponsor wallet `0x8BED1F1d4299cd65eE31A3f6c2E3bd348f8457bc` | Tops a wallet up to 0.6 MON for gas when it has under 0.45 (enough for the Lab), once per wallet/IP per 10 min, + 10,000 AUSD from Agora's faucet (one request a minute across everyone). **Keep this wallet funded: each new user costs up to ~0.6 MON** |
| Indexer (Stats, portfolio history) | Envio Cloud | Public GraphQL, see README |
| Perpl trading API | `/api/perpl`, signed on our server with the app's API key (`PERPL_API_KEY` / `PERPL_API_SECRET`, Vercel env), Perpl account #1089 | Users never paste a key. Vercel functions run in Mumbai (`bom1`): Perpl answers US requests with HTTP 451 |
| Demo liquidity | Deployer `0x0D35…2573` resting orders on the WMON/AUSD market | **Sell** 3 MON left at 0.03432 (for buys; 2 used in tests) · **buy** orders at 0.03429 (for sells) |
| RPC | Browser → our `/api/rpc` proxy (server tries thirdweb → Ankr → Monad RPC, 2 s each) → public endpoints directly as backup | Public RPCs rate-limit (Monad: 15 req/s per user), hold requests or fail DNS on some networks |

Each **buy** of 1 MON uses 1 MON of the sell orders. For more buys, send testnet MON to the deployer and post more
asks (`placeOrder(false, 2365, size, true)` after wrapping, or `pnpm mm` with a small `MM_SIZE`).

## 2. User workflow: what a new user does

```
Open https://metronome-monad.vercel.app  (phone: Share → "Add to Home Screen")
  │
  ├─ 1. Sign in (top right) → "Create account with a passkey" → Face ID / fingerprint
  │       A wallet appears. No seed phrase, no extension, no popups later.
  │
  ├─ 2. Tap the balance (top right) → "Get test MON for gas + 10,000 AUSD"
  │       Our server pays this first transaction; the wallet gets gas and AUSD.
  │       ("Faucet is busy" → tap again in a minute.)
  │
  ├─ 3. TRADE (home): Buy → amount 1 → "Now (next block)" → "Buy MON"
  │       The order joins this block's auction; the keeper settles it:
  │       "Bought 1 MON at 0.0343 AUSD in batch #…, N s after you tapped."
  │       Tap the batch to see its supply and demand curves and the clearing price.
  │       Sell works the same way (the app wraps MON for you).
  │
  ├─ 4. LAB: "Run the sandwich" → the same attack on an AMM vs on Metronome
  │       AMM victim pays ~5% more; Metronome victim pays 0%.
  │
  ├─ 5. PERPS: pick MON → "Open Perpl account with …" → "Turn on one-click trading"
  │       → Long/Short, leverage → "Long MON at market" → position with P&L → "Close at market"
  │
  ├─ 6. PORTFOLIO: Metronome orders (Filled / Refunded / Resting) and Perpl positions together
  │
  ├─ 7. Account sheet → "One passkey, many keys": Monad wallet, sub-accounts 1 and 2,
  │       Perpl API key, vault key, all derived from the one passkey; tap to switch account
  │
  └─ 8. STATS (Envio indexer) and RADAR (Nansen: who trades WMON on Monad mainnet)
```

Gas a new wallet needs: about 0.044 MON for its first trade (it includes a one-time approval), less after that; the
Lab about 0.45 MON (it checks first and offers a top-up). The faucet button tops a wallet up to 0.6 MON, which covers
the Lab, a few trades and opening a Perpl account.

## 3. The video (about 3 minutes)

Judges remember a single clear idea plus one live proof. Ours: **"every Monad block is one auction, so ordering can't
be exploited"**, proven live by the sandwich lab and the fill. Lead with the problem, show the phone, end on numbers.

Record scenes 1–8 on the phone (screen recording, portrait), 9–11 on the laptop. Speed up any waiting in the edit, and
put the bounty name on screen during its scene, so each sponsor judge finds their part.

| # | Time | Show | Say (roughly) | Bounty |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Home screen, price ticking, "MEV-protected" badge | "On today's DEXs, bots sandwich your trade and you pay for it. Metronome turns every Monad block into one auction: everyone in the block gets the same price, so there's nothing to front-run." | Track 01 |
| 2 | 0:15–0:30 | Sign in → **Create account with a passkey** → Face ID → address | "No seed phrase, no extension. My passkey *is* the wallet, through Mera." | Mera UX |
| 3 | 0:30–0:40 | Account sheet → **Get test MON for gas + 10,000 AUSD** → balance | "Everything is priced in AUSD. One tap, and new users don't even need gas to start." | Agora |
| 4 | 0:40–1:05 | Buy 1 MON, **Now (next block)** → "Bought 1 MON … N s after you tapped" | "No wallet popup, no claim button. My order joined this block's auction, cleared, and was paid out automatically." | Track 01, Mera UX |
| 5 | 1:05–1:20 | Tap the batch → supply/demand curves crossing | "This is that block's auction: buyers and sellers meet at one clearing price." | Track 01 |
| 6 | 1:20–1:50 | **Lab** → **Run the sandwich** → AMM −5.27% vs Metronome 0% | "Same attack, two venues. On an AMM the victim loses five percent. On Metronome they lose nothing." **Give this scene time: it is the proof.** | Track 01, Grand Champion |
| 7 | 1:50–2:15 | **Perps** → open account → Long MON 2× → P&L → **Close at market** | "The same wallet trades perpetuals on Perpl, straight on their contract." | Perpl, Agora |
| 8 | 2:15–2:30 | **Portfolio**, then **One passkey, many keys** → switch to Sub-account 1 | "One passkey derives my wallet, sub-accounts, a Perpl API key and an encryption key. Nothing is stored." | Mera Many Keys, Agora |
| 9 | 2:30–2:45 | Terminal: `cre workflow simulate … --broadcast` → tx on monadscan | "Chainlink CRE is the exchange's heartbeat: it settles batches and brings MON/USD on-chain." | Chainlink |
| 10 | 2:45–2:55 | `/stats` and `/radar` | "Stats come from our Envio indexer. The radar uses Nansen: five bots make 75% of WMON trades on Monad." | Envio, Nansen |
| 11 | 2:55–3:05 | Repo, test output, `docs/benchmark.md` | "112 contract tests, fully onchain, and only possible with Monad's 400 ms blocks." | Grand Champion |

## 4. Recording-day checklist

1. **2 minutes before:** open the app on the laptop to wake the keeper
   ([`/health`](https://metronome-keeper.onrender.com/health) should say `"ready":true`).
2. Trade screen shows **Best ask 0.03432**. If not, the sell orders were bought: top up the deployer and post more.
3. Phone: iOS 18+ Safari or recent Android Chrome; Do Not Disturb on; app added to the home screen.
4. Phone wallet funded with ~1 MON (faucet.monad.xyz) plus AUSD from the in-app button. Do a full dry run first,
   on the same phone, so the wallet, Perpl account and balances already exist.
5. Faucet wallet `0x8BED…57bc` has MON (each new user costs ~0.11 MON).

## 5. If something goes wrong

| You see | Why | Do |
|---|---|---|
| "No counterparty in batch … refunded" | No sell orders left at your price | Post more asks (section 1) |
| "Not enough MON to pay gas" | Wallet out of MON | Account sheet → faucet button, or send MON |
| "Agora's AUSD faucet is busy" | One AUSD request a minute across all users | Wait a minute, tap again |
| "funded recently. Try again in N min" | Free MON is once per wallet/network per 10 min | Wait, or send MON directly |
| Order stuck on "Clearing batch…" | Keeper was asleep | Wait ~1 min; it settles everything pending when it wakes |
| Passkey error on an older phone | No PRF support | Use iOS 18+ Safari or a recent Android Chrome |
