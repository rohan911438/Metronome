# Metronome web

Mobile-first PWA: Next.js (App Router), [viem](https://viem.sh), [Mera](https://mera.category.xyz) passkey accounts, Tailwind. Design: [`../docs/architecture.md`](../docs/architecture.md) §4.3.

There is no backend or indexer. Every page reads the contract over RPC once per block.

| Page | What it shows |
|---|---|
| `/` Trade | Buy/sell ticket ("Now": a taker order in the next batch with a max price move; "Limit": a resting maker order), last clearing price, the book drawn as supply and demand, recent batches |
| `/portfolio` | Balances and the last 30 orders with status (in batch → paying out → filled/refunded; resting → filled/cancelled), cancel for resting orders |
| `/batch/[id]` | One batch: its orders as supply and demand, the clearing price, volume, which side was rationed |
| `/lab` | Sandwich demo: the same attack on an AMM and on Metronome, side by side; "Run it yourself" where SandwichLab is deployed |

**Login and signing (Mera).** "Create account with a passkey" (Face ID, fingerprint or screen lock). Mera reads the passkey's WebAuthn PRF output, and `src/lib/keys.ts` derives every key from it: the Monad wallet at BIP-44 `m/44'/60'/0'/0/0`, and an Ed25519 key for Perpl's API (HKDF with its own label). The wallet key lives only in an in-memory Mera signing session, so every transaction is signed in-app with no popup; after a reload the user unlocks with the passkey again. Nothing is stored on a server, and a synced passkey on another device recovers the same keys. Every transaction's gas limit is `estimateGas + 20%`, because Monad charges for the gas limit. On the local chain there is also a "local test account" (a throwaway key in localStorage) for development.

Passkeys need PRF support: recent Chrome/Edge, Safari on iOS 18+ / macOS 15+, recent Android. Unsupported devices get a clear message.

**Orders without logs.** Order IDs are `keccak256(abi.encode(owner, nonce))` and `nonces(owner)` is public, so the portfolio finds a user's orders with plain reads and doesn't need `eth_getLogs` over a long range.

## Run locally

```sh
pnpm install               # repo root
pnpm dev:local             # terminal 1: Anvil :8545 + deploy + keeper + market maker + background traders
pnpm web:dev               # terminal 2: http://localhost:3000
```

Open the account sheet, then "Create account with a passkey" (or "Use a local test account") and "Get test funds". Passkeys work on `http://localhost`.

## Configuration

`web/.env.local` (copy from `.env.example`):

| Variable | |
|---|---|
| `NEXT_PUBLIC_NETWORK` | `local` (default), `testnet` or `mainnet`: picks the chain and the deployment in `contracts/deployments/<chainId>.json` |
| `NEXT_PUBLIC_RPC_URL` | Optional RPC override |

`pnpm dev` and `pnpm build` first run `scripts/sync.mjs`, which copies the ABIs (`bots/src/abi.ts`) and deployment addresses into `src/generated/`.
