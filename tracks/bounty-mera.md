# Monad Foundation — Mera bounties ($2,500 + $2,500 cash)

1. **Best Mera-Powered UX** — $2,500
2. **Mera: One Passkey, Many Keys** — $2,500

> ⚠️ **Official requirements are TBC.** Copy the exact wording of both from the hackathon dashboard here. The plan for #2 is inferred from its title.

Mera (Category Labs, `@category-labs/mera`, open source, **no API key or signup**) derives accounts from a passkey via the WebAuthn PRF extension: no seed phrase, no backend custody. Needs a passkey provider with PRF (recent Chrome/Safari/Android; iOS 18+, Android 9+ for React Native). Docs: https://mera.category.xyz. Mera login is also required by the **Agora** bounty.

## What we build
**Login (replaces Privy):** "Continue with Face ID" → `getPasskeyPrfOutput({ rpId })` → derive keys → `createSecp256k1SigningSession` → `toViemAccount` → every Metronome and Perpl transaction is signed in-app with no popup. The session lives in memory; ending it zeroes the key.

**One passkey, many keys:** the same PRF output derives every key the app needs, each on its own path:
| Key | Derivation | Used for |
|---|---|---|
| Monad wallet | BIP-44 `m/44'/60'/0'/0/0` (secp256k1) | Holds MON/WMON/AUSD, places Metronome orders, Perpl deposits |
| Perpl API key | Ed25519 from a separate derivation (SLIP-10) | Signs every Perpl trading request |
| Bot / sub-accounts (stretch) | `m/44'/60'/0'/0/i` | Separate accounts for a market-making bot or strategies, recoverable from the same passkey |

A user who logs in on a new device with the synced passkey gets back **all** of them, with nothing stored on any server.

## How we plan to win
- Zero to first trade in under 30 seconds: Face ID → funded → trade, filmed on a real phone
- The "many keys" story is structural (one passkey drives two venues' credentials), not a demo toggle
