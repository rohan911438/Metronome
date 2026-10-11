import { createPublicClient, defineChain, fallback, http, type Address, type Chain, type Transport } from "viem";
import { anvil, monad, monadTestnet } from "viem/chains";
import { deployments, labs } from "@/generated/deployments";

export type Network = "local" | "testnet" | "mainnet";

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "local") as Network;

const localChain = defineChain({ ...anvil, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const CHAINS: Record<Network, Chain> = { local: localChain, testnet: monadTestnet, mainnet: monad };

export const chain = CHAINS[NETWORK];
export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0]!;
export const isLocal = NETWORK === "local";
/**
 * Dev fork: the testnet app pointed at a local Anvil fork of Monad testnet (`pnpm perpl:fork`), so flows against real
 * testnet contracts such as Perpl can run with test funds. Never true in a deployed build, whose RPC is not localhost.
 */
export const isFork = !isLocal && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(rpcUrl);
/** Throwaway test accounts and test funding are offered only on local chains. */
export const devChain = isLocal || isFork;
/**
 * How often the app looks for a new block. Monad blocks are ~0.4 s, but refreshing every page's reads that often from
 * every open browser runs into public RPC rate limits; 0.7 s still feels live.
 */
export const POLL_MS = isLocal ? 500 : 700;
/** Metronome.PRICE_BAND: once the market has traded, orders must be within this many ticks of the last clearing price. */
export const PRICE_BAND = 128;
/** Max block span per eth_getLogs call; public RPCs cap this. */
export const LOG_CHUNK = 100n;

export interface Deployment {
  address: Address;
  base: Address;
  quote: Address;
  priceMin: bigint;
  shards: number;
  minOrderSize: bigint;
  deployBlock: bigint;
  miniAmm?: Address;
  sandwichLab?: Address;
  quoteSymbol: string;
  quoteDecimals: number;
}

function load(): Deployment {
  const raw = (deployments as Record<string, (typeof deployments)[keyof typeof deployments]>)[String(chain.id)];
  if (!raw) throw new Error(`no Metronome deployment for chain ${chain.id}`);
  return {
    address: raw.address,
    base: raw.base,
    quote: raw.quote,
    priceMin: BigInt(raw.priceMin),
    shards: Number(raw.shards),
    minOrderSize: BigInt(raw.minOrderSize),
    deployBlock: BigInt(raw.deployBlock),
    miniAmm: "miniAmm" in raw ? raw.miniAmm : undefined,
    sandwichLab: "sandwichLab" in raw ? raw.sandwichLab : undefined,
    // Deployments before the quote token was recorded are AUSD (or the local 6-decimal mock).
    quoteSymbol: "quoteSymbol" in raw ? raw.quoteSymbol : "AUSD",
    quoteDecimals: "quoteDecimals" in raw ? Number(raw.quoteDecimals) : 6,
  };
}

export const deployment = load();

/** The sandwich lab: its own market on open-mint test tokens on testnet, or next to the main market locally. */
export interface Lab {
  metronome: Address;
  base: Address;
  quote: Address;
  miniAmm: Address;
  sandwichLab: Address;
  deployBlock: bigint;
  /** Test tokens anyone can mint (the lab moves ~200k MON, more than testnet faucets give). */
  mintable: boolean;
}

function loadLab(): Lab | undefined {
  const raw = (labs as Record<string, (typeof labs)[keyof typeof labs]>)[String(chain.id)];
  if (raw) return { ...raw, deployBlock: BigInt(raw.deployBlock) };
  if (!deployment.miniAmm || !deployment.sandwichLab) return undefined;
  const { address, base, quote, miniAmm, sandwichLab, deployBlock } = deployment;
  return { metronome: address, base, quote, miniAmm, sandwichLab, deployBlock, mintable: false };
}

export const lab = loadLab();

/**
 * Token metadata. The quote asset is AUSD on mainnet, Agora's testnet AUSD on testnet (from Agora's faucet), and a
 * 6-decimal mock locally; the deployment records which.
 */
export const BASE = { symbol: "WMON", native: "MON", decimals: 18 } as const;
export const QUOTE = { symbol: deployment.quoteSymbol, decimals: deployment.quoteDecimals };

/**
 * Testnet RPC. Monad's public endpoint allows 15 requests/s per user, too few for an app polling every block, and
 * public endpoints sometimes hold a request or fail DNS from the user's network, which froze the app ("RPC failing").
 * So in the browser, reads and sends go first to our own /api/rpc (same origin; the server tries thirdweb, Ankr and
 * Monad's RPC in turn), then straight to those endpoints if our server is unreachable. Each try gives up after
 * `timeout`; sends keep a long one, since a send retried elsewhere after a timeout could be broadcast twice.
 * NEXT_PUBLIC_RPC_URL overrides all of this with one endpoint.
 */
const TESTNET_RPCS = ["https://rpc.ankr.com/monad_testnet", "https://10143.rpc.thirdweb.com", "https://testnet-rpc.monad.xyz"];
export function rpcTransport(opts: { batch?: boolean | { batchSize: number }; timeout?: number } = {}): Transport {
  const { batch, timeout = 10_000 } = opts;
  if (NETWORK !== "testnet" || process.env.NEXT_PUBLIC_RPC_URL) return http(rpcUrl, { batch, timeout });
  const urls = typeof window === "undefined" ? TESTNET_RPCS : [`${window.location.origin}/api/rpc`, ...TESTNET_RPCS];
  return fallback(
    urls.map((u) => http(u, { batch, timeout, retryCount: 0 })),
    { retryCount: 1, retryDelay: 150 },
  );
}

export const publicClient = createPublicClient({
  chain,
  transport: rpcTransport({ batch: { batchSize: 10 }, timeout: 5_000 }), // Ankr rejects batches over 10 (HTTP 413)
  pollingInterval: POLL_MS,
});

export const explorerTx = (hash: string) =>
  chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined;

/**
 * The hosted keeper (bots/src/keeper-service.ts on Render). Its free instance sleeps when idle, so the app pings it
 * while open (app/providers.tsx) to wake it; it then settles and pays out pending batches.
 */
export const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "";
