# Agora — Best Mobile Trading App on Monad

**Sponsor:** Agora (issuer of the **AUSD** stablecoin)
**Amount:** Agora's total is $20k, covering "mobile trading" and "cross-border payments". The exact amount for this bounty is TBC.
**Closes:** Oct 14, 2026, 04:59 GMT+1 (per public listing)

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here before building.
> The cross-border sibling bounty requires a *mobile app* and Mera passkey onboarding. This one may have similar strict rules.

## Likely eligibility (to confirm)
- A trading app that works on **mobile**
- Uses **AUSD** (testnet AUSD is available for this bounty)
- Deployed on Monad

## What we do to qualify
| Likely requirement | Metronome |
|---|---|
| Mobile trading app | Mobile-first PWA (installable to the home screen). If a native app is required, wrap it with Capacitor or Expo |
| Uses AUSD | **MON/AUSD** is the first and main market; AUSD is the quote asset |
| On Monad | Contracts on Monad testnet, then mainnet |

## How we plan to win
- **Face ID login and one-tap trade**: no seed phrase and no wallet popups (via Privy)
- Show "MEV-protected price" on every trade. Mobile users get sandwiched the most, since they tend to use loose slippage settings
- Fast: the trade is confirmed and settled within about 1 second on the phone
- Record part of the demo video on an actual phone

## Open questions
- [ ] Does a PWA count as a "mobile app", or does it need to be native?
- [ ] Is AUSD mandatory or just a bonus?
- [ ] Is a specific SDK required (like Mera for the cross-border bounty)?
