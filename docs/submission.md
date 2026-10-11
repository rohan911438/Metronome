# Submission kit (target Oct 12)

Everything below is built and on testnet unless marked **(you)**: those steps need the user's phone, wallet or
accounts.

## 1. Before filming

- [ ] **(you)** Send ~3 MON (mainnet) to the deployer `0x0D350bc1b4102732cFe243f80fe693f428572373` if we deploy to
      mainnet: deploy ~1.4 MON, the rest for seeding and settles. Plus a little AUSD/WMON to seed the book. Skip this
      and we submit on testnet (allowed; the radar already reads mainnet).
- [ ] **(you)** Claim testnet MON from the faucet (Cloudflare check) for the phone's passkey wallet: ~1 MON covers a
      Metronome trade, a Perpl account (needs 100 AUSD from the in-app faucet button) and a lab run.
- [x] Deploy the web app with `NEXT_PUBLIC_NETWORK=testnet`: https://metronome-monad.vercel.app (Vercel, Oct 11;
      passkeys are bound to this domain). Keeper on Render: https://metronome-keeper.onrender.com/health.
- [ ] **(you)** On a phone with passkey PRF (iOS 18+ Safari, or recent Android Chrome): open the URL, "Add to Home
      Screen".

## 2. Demo video (~3 min) shot list

| # | Shot | Shows | Bounty |
|---|---|---|---|
| 1 | 15 s pitch over the trade screen: "every Monad block is one auction; everyone gets the same price" | the problem and the idea | Track 01 |
| 2 | Open the installed app → **Continue with Face ID** → wallet appears, no seed phrase | Mera login | Mera UX, Agora |
| 3 | Account sheet → **Get test MON for gas + 10,000 AUSD** → AUSD balance in the header (our server pays the gas, so a brand-new wallet works) | AUSD balance | Agora |
| 4 | Trade tab: buy MON "Now" → fill card a second later; no popup, no claim | Metronome trade, popup-free signing | Track 01, Mera UX |
| 5 | Supply/demand chart animating, `/batch/<id>` page for the fill | uniform clearing price | Track 01 |
| 6 | Lab: **Run the sandwich** → AMM victim −5%, Metronome 0% | MEV protection, live on testnet | Track 01 |
| 7 | Perps tab: open the Perpl account (3 steps) → long MON 2× → position with P&L → close | trades through Perpl | Perpl, Agora |
| 8 | Portfolio: Metronome orders + Perpl position on one screen | one wallet, two venues | Agora |
| 9 | Keys panel: one passkey → wallet, sub-accounts, Perpl key, vault key; switch sub-account | one passkey, many keys | Mera Many Keys |
| 10 | Terminal: `cre workflow simulate … --broadcast` → tx on monadscan settling a batch + MON/USD | CRE as the heartbeat | Chainlink |
| 11 | `/stats` (from the Envio indexer on testnet) and `/radar` (Nansen: 5 bots = 75% of WMON trades) | data layer | Envio, Nansen |
| 12 | 10 s close: tests (112 Foundry + 7 Go), benchmark, "built for Monad" | credibility | Grand Champion |

Record shots 1–9 on the phone (screen recording), 10–12 on the laptop.

## 3. What to say per bounty (one paragraph each for the form)

- **Track 01 / Grand Champion:** A fully onchain frequent batch auction: all orders in a Monad block clear at one
  uniform price, so sandwiching and front-running have nothing to extract (live lab: −5.27% on an AMM, 0% on Metronome).
  Resting maker orders in per-price pools, 112 Foundry tests with differential fuzzing and invariants, keeper and
  market-maker bots, and a benchmark of how sharding interacts with Monad's parallel execution.
- **Agora:** Mobile PWA: Mera passkey login, AUSD balance (Agora faucet in one tap), Metronome spot trades quoted in
  AUSD and Perpl perp trades collateralised in AUSD, all from one passkey wallet with no popups.
- **Perpl:** Perps tab built on Perpl's public API (markets, tickers, order book, candles) and Perpl's exchange
  contract (account opening, IOC long/short with leverage, positions and one-tap close), live on testnet. API-key
  enrollment is ready but waits on Perpl whitelisting our origin.
- **Mera UX:** Face ID login, every transaction signed in-app through a Mera signing session (no popups), clear message
  on devices without PRF.
- **Mera Many Keys:** One PRF output derives the Monad wallet, sub-accounts (each its own Perpl account), an Ed25519
  Perpl API key and an AES key that encrypts secrets on the device. Nothing is stored; a synced passkey restores all.
- **Chainlink CRE:** `cre/metronome-heartbeat` is the exchange's keeper and price feed: cron → finds the pending batch →
  fetches MON/USD from Coinbase (DON median) → one report settles the batch and updates an `IAggregatorV3` feed the
  oracle guard reads. Real user orders settled by `simulate --broadcast` on testnet. Please deploy it (deploy access
  is pending on our org).
- **Nansen:** `/radar`: Nansen DEX trades with labels and first funders for WMON on Monad mainnet; sandwich candidates
  verified block by block. Finding: 5 bot wallets made 75% of trades; 0 verified sandwiches (Monad's ordering makes
  them hard, and Metronome removes them entirely).
- **Envio:** HyperIndex indexer (Docker) for every Metronome event, totals checked exactly against raw logs; powers
  `/stats` and order times/payouts in the portfolio. Runs on testnet without a HyperSync token over public RPCs.

## 4. Submit

- [ ] **(you)** Project page on hackathon.monad.xyz: repo link, video link, live URL, testnet addresses (README).
- [ ] **(you)** Opt in to: Agora, Perpl, Mera ×2, Nansen, Chainlink CRE, Envio. Confirm each is paid in cash.
- [ ] **(you)** Chainlink: ask them to deploy the simulated workflow (Discord / form).
