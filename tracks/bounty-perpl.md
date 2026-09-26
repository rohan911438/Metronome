# Perpl — Best use of Perpl's API ($5,000 cash)

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here.
> Perpl's second bounty ("Best Analytics / Risk Tool", $3k) is a separate product and not a target.

Perpl is a fully onchain perpetual-futures order book on Monad. Its trades are also what the **Agora** bounty requires ([bounty-agora-mobile-trading.md](bounty-agora-mobile-trading.md)), so this work goes after both.

## What we build: Perps tab in the Metronome app

| Step | How |
|---|---|
| Market data | Public REST + market-data WebSocket (no key): prices, order book, funding for MON / BTC / ETH perps |
| Account setup (onchain, once) | Approve collateral → `createAccount(amount)` → `allowOrderForwarding(true)` on the Perpl exchange, signed by the user's Mera wallet |
| API key (once) | Generate an Ed25519 key **derived from the user's passkey** (see [bounty-mera.md](bounty-mera.md)); `POST /api/v1/api-key/payload` → user's wallet signs the EIP-712 payload + Ed25519 proof of possession → `POST /api/v1/api-key/enroll` |
| Trading | Place/cancel orders over the trading WebSocket (`/ws/v1/trading`); Perpl submits the transactions and pays gas |
| Portfolio | Positions, open orders, P&L and collateral (AUSD) next to the Metronome balances |

## Facts from the docs (github.com/PerplFoundation/api-docs, checked Sep 26)
| | Testnet (10143) | Mainnet (143) |
|---|---|---|
| REST / WS | `https://testnet.perpl.xyz/api`, `wss://testnet.perpl.xyz` | `https://app.perpl.xyz/api`, `wss://app.perpl.xyz` |
| Exchange | `0x1964c32f0be608e7d29302aff5e61268e72080cc` | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |
| Collateral | Perpl "USD" `0xdf5b718d8fcc173335185a2a1513ee8151e3c027` | **AUSD** `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (min deposit 100 AUSD) |
| Markets | BTC 16, ETH 32, SOL 48, MON 64, ZEC 256 | BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50 |
| Rate limit (trading WS) | 60 req/min, 4 connections per wallet | 120 req/min |

## Blockers (need the Perpl team)
- [ ] **Origin whitelist:** in-app key enrollment from a browser is rejected unless Perpl whitelists our origin (`http://localhost:3000` + the deployed URL). Without it, users would create keys on perpl.xyz and paste them (poor UX)
- [ ] **Testnet collateral:** how to get testnet "USD"; is the testnet beta open to everyone?
- [ ] Optional: a **builder code** (attributes our volume; lets us charge a fee later)

## How we plan to win
- Onboarding to a first perp trade entirely inside our app: passkey → deposit → key → trade, no visit to perpl.xyz
- One app, two venues: spot on Metronome (MEV-proof batch auction), perps on Perpl
