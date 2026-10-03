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

## Trading (Oct 3)
**Live on Monad testnet (Oct 3)**, from a passkey wallet in the app (headless Edge, virtual passkey): Perpl account #792 opened with 150 AUSD ([approve](https://testnet.monadscan.com/tx/0x59800065fd8024e31451a1cc008a26439c50acab5143ce4ac15fb4670225a49a), [createAccount](https://testnet.monadscan.com/tx/0xd224f5c33e36e3ec7a3d7647dcb0fcf25da4f0fe77653f5faa052f91714efdac), [forwarding](https://testnet.monadscan.com/tx/0xc9768b6332e649bc90b88b41c52a7cdb811708bb914ece27ea6a364d0f53edf0)); [long 1,000 MON at 2×](https://testnet.monadscan.com/tx/0xc54e2ccb0a1465f5ff692b48b14370c1117e86527937e396185c1cebac73cc3d) filled at 0.03132 and was [closed](https://testnet.monadscan.com/tx/0x4a1001261ea5f8b4fa26e00aa6bb45ae14830575e61aa87515a97b29f30d841a); a [short of 500 MON](https://testnet.monadscan.com/tx/0x5698100ce177657c7695c5c6b785cbab91a2b449ddd0701564f8e6bf08b2cd9a) filled at 0.03125. The test browser's virtual passkey was discarded afterwards, so that short is still open on testnet (account #792, wallet `0x9058…C2c1`).

Order fields, from dex-sdk `request.rs`: orderType 0 open long / 1 open short / 2 close long / 3 close short / 4 cancel; `pricePNS`, `lotLNS` scaled by the market's decimals; `leverageHdths` in hundredths; `maxMatches` 1..1000 (0 silently means 1000); `maxNegPnlCollatBPS` 1000 (SDK default). `getPosition` positionType 0 = long, 1 = short. Error `0x7d19aaec(perpId, oracleTime, now, maxAge)`: oracle price older than `refPriceMaxAgeSec` (60 s on MON).

## Live findings (Sep 26, probed testnet.perpl.xyz)
- **Testnet collateral is AUSD** `0xa9012a…22dC` (the same testnet AUSD Metronome uses), not the "USD" token in the docs. So the Agora demo (AUSD + Perpl trade) works on testnet.
- `/v1/pub/context`: exchange `0x1964c32f…80cc`, **min account open 100 AUSD** (100000000), min deposit 10 AUSD. Markets: BTC 16, ETH 32, SOL 48, **MON 64** (price decimals 5, size decimals 0), ZEC 256, LIT 272, PUMP 320; taker fee 345 micros; order TTL 20 blocks.
- **No CORS headers** on the REST API (preflights 404/405): browser calls need a pass-through route on our Next.js server.
- **The market-data WebSocket also refuses browser origins:** `Origin: http://localhost:3000` → HTTP 403; no Origin (a server client, as in Perpl's own Node examples) works. So the `/perps` tab polls our cached REST pass-through (`web/src/app/api/perpl`) instead. If Perpl whitelists our origin, the page can switch to the WebSocket directly.
- Key enrollment with `Origin: http://localhost:3000` → 400 (origin not whitelisted). We must not strip the origin to get around it; the whitelist is Perpl's call.
- **Direct on-chain trading needs no API key or whitelist:** Exchange ABI is published at PerplFoundation/dex-sdk `crates/sdk/abi/dex/Exchange.json`. The user's Mera wallet can call `createAccount(amountCNS)`, `execOrders(orderDescs, revertOnFail)` / `execOrder((orderDescId, perpId, orderType, orderId, pricePNS, lotLNS, expiryBlock, postOnly, fillOrKill, immediateOrCancel, maxMatches, leverageHdths, lastExecutionBlock, amountCNS, maxNegPnlCollatBPS))`, and read `getAccountByAddr`, `getPosition(perpId, accountId)`. Order field defaults: see dex-sdk `crates/sdk/src/types/request.rs` (not yet read).
- **Account opening is open to anyone:** `whitelistingEnabled()` is false; 711 accounts existed on Sep 26. Opening needs ≥100 AUSD; `getAccountByAddr` reverts `0x03a0e277(address)` when there's no account (the error isn't in the published ABI). There's no getter for the forwarding flag, only the `OrderForwardingUpdated(accountId, allowed)` event.
- **Proven on a fork (Sep 26):** approve → `createAccount(150 AUSD)` → `allowOrderForwarding(true)` from the app succeeds against Perpl's real contract on an Anvil fork of testnet (gas: createAccount ~143k, forwarding ~39k).
- **No way to swap into testnet AUSD:** Uniswap's testnet contracts (from its SDK) have no code on the current testnet, Kuru's testnet markets are all quoted in its own USDC, and a scan of ~250k blocks of AUSD transfers found no pool. AUSD sits in the Perpl exchange (~64M) and one wallet `0xeB5e507219fE11bb0B7FACE2e18580B72E9c4a36` (~7.3M, likely a team treasury): worth naming when asking Agora/Perpl for a top-up.
- **Plan for 4b:** public market data through a server pass-through; account open + orders sent on-chain from the Mera wallet (works now); API-key path (derived Ed25519 key) added once Perpl whitelists us. Still blocked on **≥100 testnet AUSD** for account open (ask Perpl/Agora); a local Anvil fork of testnet with a funded AUSD balance can validate the calls meanwhile.
