# Agora — Best Mobile Trading App on Monad

**Sponsor:** Agora (issuer of the **AUSD** stablecoin)
**Amount:** $10,000, single prize. The sibling "Best Cross-Border Payments App on Monad" is a separate $10,000.
**Track:** Onchain Finance & Trading
**Deadline:** Oct 14, 2026, 09:29 GMT+5:30

## Official rules (copied from the hackathon dashboard, Sep 26)

> Build a mobile app authenticating via Mera, holding an AUSD balance, and executing trades through Perpl.

**Eligibility:** a team must build a mobile application that
1. authenticates users via **Mera** (Monad's passkey authentication),
2. holds and displays a stablecoin balance in **AUSD**,
3. executes trades through **Perpl**.

**Judging criteria:** implementation quality; user experience; creative use of the three integrations together, not just technical completeness.

**Deliverable:** a working demo showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl.

Resources: docs.agora.finance/contract-overview, docs.agora.finance, docs.monad.xyz, developers.monad.xyz.

## Status: applying (decided Sep 26)

We switch login from Privy to **Mera** and add a **Perpl** perps tab; Metronome stays the main product. Plans: [bounty-mera.md](bounty-mera.md), [bounty-perpl.md](bounty-perpl.md).

| Requirement | How we meet it |
|---|---|
| Mobile app, Mera passkey login | Metronome PWA, "Continue with Face ID" via Mera |
| Holds and displays an AUSD balance | AUSD balance in the header, account sheet and portfolio; "Get 10,000 AUSD" calls Agora's testnet faucet; the same AUSD is Metronome's quote asset and Perpl's collateral (testnet too) |
| Executes trades through Perpl | Perps tab: long/short orders sent from the passkey wallet straight to Perpl's exchange contract (live on testnet Oct 3); positions also in the portfolio |
| Demo: passkey login → fund/view AUSD → at least one Perpl trade | Filmed on a real phone |

**Resolved (Oct 3):** Perpl's testnet collateral *is* Agora's testnet AUSD (`0xa901…22dC`), and Agora's faucet works again, so the whole flow (passkey → AUSD → Perpl trade) runs on testnet with real AUSD. Still open: whether a PWA counts as a "mobile application" (we film it installed on a real phone).

## Reference

- **Mera:** Category Labs' TypeScript library that derives an EVM account from a passkey (WebAuthn PRF), with no backend or seed phrase. https://github.com/category-labs/mera, docs at https://mera.category.xyz
- **Perpl:** fully onchain perps order book on Monad; testnet at testnet.perpl.xyz, API docs at https://github.com/PerplFoundation/api-docs
- AUSD: testnet token `0xa901…22dC` exists, and the faucet works again since Oct 3 (10,000 AUSD per request; the app has a one-tap button); the Agora API (docs.agora.finance/api) is mainnet-only.
