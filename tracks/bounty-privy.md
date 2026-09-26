# Privy — Integration bounty ($5,000)

> **Dropped (Sep 26).** Login moves to Mera (required by the Agora bounty). Kept for reference. The app ID `cmui208va006j0djv8197g0ax` is unused once Mera replaces Privy.

> ⚠️ **Official requirements are TBC.** Copy the exact wording from the hackathon dashboard here.
> One known rule from public sources: **"Integrate Privy beyond authentication — login-only integrations will not qualify."**

## Likely eligibility
- Use Privy in the app, **and go beyond login**

## What we do to qualify (beyond login)
| Privy feature | How Metronome uses it |
|---|---|
| Passkey / Face ID login | Onboard with no seed phrase |
| **Embedded wallet** | Every user gets a Monad wallet automatically; it holds AUSD and MON |
| **In-app transaction signing** | Place, cancel and claim orders without a wallet popup |
| **Funding / onramp** (if available on Monad) | "Add AUSD" button in the app |
| **Gas sponsorship / smart wallets** (if available on Monad) | First trades are free for new users |
| Session or delegated signing (stretch goal) | Auto-claim fills after each batch, so users don't have to tap Claim |

## How we plan to win
- Make Privy central to the story: "from zero to your first MEV-protected trade in under 30 seconds"
- Show the full new-user flow in the demo video: Face ID → wallet created → fund → trade → claimed
