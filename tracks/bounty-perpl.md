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

## Live findings (Sep 26, probed testnet.perpl.xyz)
- **Testnet collateral is AUSD** `0xa9012a…22dC` (the same testnet AUSD Metronome uses), not the "USD" token in the docs. So the Agora demo (AUSD + Perpl trade) works on testnet.
- `/v1/pub/context`: exchange `0x1964c32f…80cc`, **min account open 100 AUSD** (100000000), min deposit 10 AUSD. Markets: BTC 16, ETH 32, SOL 48, **MON 64** (price decimals 5, size decimals 0), ZEC 256, LIT 272, PUMP 320; taker fee 345 micros; order TTL 20 blocks.
- **No CORS headers** on the REST API (preflights 404/405): browser calls need a pass-through route on our Next.js server.
- **The market-data WebSocket also refuses browser origins:** `Origin: http://localhost:3000` → HTTP 403; no Origin (a server client, as in Perpl's own Node examples) works. So the `/perps` tab polls our cached REST pass-through (`web/src/app/api/perpl`) instead. If Perpl whitelists our origin, the page can switch to the WebSocket directly.
- Key enrollment with `Origin: http://localhost:3000` → 400 (origin not whitelisted). We must not strip the origin to get around it; the whitelist is Perpl's call.
- **Direct on-chain trading needs no API key or whitelist:** Exchange ABI is published at PerplFoundation/dex-sdk `crates/sdk/abi/dex/Exchange.json`. The user's Mera wallet can call `createAccount(amountCNS)`, `execOrders(orderDescs, revertOnFail)` / `execOrder((orderDescId, perpId, orderType, orderId, pricePNS, lotLNS, expiryBlock, postOnly, fillOrKill, immediateOrCancel, maxMatches, leverageHdths, lastExecutionBlock, amountCNS, maxNegPnlCollatBPS))`, and read `getAccountByAddr`, `getPosition(perpId, accountId)`. Order field defaults: see dex-sdk `crates/sdk/src/types/request.rs` (not yet read).
- **Plan for 4b:** public market data through a server pass-through; account open + orders sent on-chain from the Mera wallet (works now); API-key path (derived Ed25519 key) added once Perpl whitelists us. Still blocked on **≥100 testnet AUSD** for account open (ask Perpl/Agora); a local Anvil fork of testnet with a funded AUSD balance can validate the calls meanwhile.
