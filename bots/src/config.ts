import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { anvil, monad, monadTestnet } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
loadEnv({ path: resolve(repo, "bots/.env"), quiet: true });

export type Network = "local" | "testnet" | "mainnet";

/** Addresses written by the Foundry deploy scripts (contracts/deployments/<chainId>.json). */
export interface Deployment {
  address: Address;
  base: Address;
  quote: Address;
  owner: Address;
  priceMin: bigint;
  shards: number;
  minOrderSize: bigint;
  deployBlock: bigint;
  quoteDecimals: number;
  miniAmm?: Address;
  sandwichLab?: Address;
  /** MetronomeHeartbeat (Chainlink CRE receiver and MON/USD feed) for this market, if deployed. */
  heartbeat?: Address;
}

export interface Ctx {
  network: Network;
  chain: Chain;
  rpcUrl: string;
  public: PublicClient<Transport, Chain>;
  deployment: Deployment;
  /** Poll interval for new blocks. Monad blocks are ~0.3 s. */
  pollMs: number;
  /** Max block span per eth_getLogs call; public RPCs cap this. */
  logChunk: bigint;
}

const CHAINS: Record<Network, Chain> = { local: anvil, testnet: monadTestnet, mainnet: monad };

export function loadDeployment(chainId: number, root = repo): Deployment {
  const all = JSON.parse(readFileSync(resolve(root, `contracts/deployments/${chainId}.json`), "utf8"));
  const raw = all.metronome;
  if (!raw) throw new Error(`no "metronome" entry in deployments/${chainId}.json`);
  const hb = all.heartbeat;
  return {
    ...raw,
    // Deployments before the quote token was recorded are AUSD or the local 6-decimal mock.
    quoteDecimals: Number(raw.quoteDecimals ?? 6),
    heartbeat: hb && hb.metronome?.toLowerCase() === raw.address.toLowerCase() ? hb.address : undefined,
    priceMin: BigInt(raw.priceMin),
    shards: Number(raw.shards),
    minOrderSize: BigInt(raw.minOrderSize),
    deployBlock: BigInt(raw.deployBlock),
  };
}

export function createCtx(overrides: Partial<{ network: Network; rpcUrl: string }> = {}): Ctx {
  const network = (overrides.network ?? process.env.NETWORK ?? "testnet") as Network;
  const chain = CHAINS[network];
  if (!chain) throw new Error(`unknown NETWORK "${network}" (local | testnet | mainnet)`);
  const rpcUrl = overrides.rpcUrl ?? process.env.RPC_URL ?? chain.rpcUrls.default.http[0]!;
  const pollMs = Number(process.env.POLL_MS ?? (network === "local" ? 200 : 400));
  return {
    network,
    chain,
    rpcUrl,
    // viem's default 4 s polling would make every receipt wait ~13 Monad blocks.
    public: createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: pollMs }),
    deployment: loadDeployment(chain.id),
    pollMs,
    logChunk: BigInt(process.env.LOG_CHUNK ?? 100),
  };
}

export type Wallet = WalletClient<Transport, Chain, Account>;

/** A wallet whose nonces are tracked locally, so a bot can send several transactions without waiting. */
export function walletFor(ctx: Ctx, privateKey: Hex): Wallet {
  const account = privateKeyToAccount(privateKey, { nonceManager });
  return createWalletClient({ account, chain: ctx.chain, transport: http(ctx.rpcUrl), pollingInterval: ctx.pollMs });
}

/** Reads a private key from the environment; falls back to the deployer key in contracts/.env. */
export function keyFromEnv(name: string): Hex {
  const direct = process.env[name];
  if (direct) return direct as Hex;
  try {
    const env = readFileSync(resolve(repo, "contracts/.env"), "utf8");
    const match = env.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m);
    if (match) return match[1] as Hex;
  } catch {
    // no contracts/.env
  }
  throw new Error(`set ${name} in bots/.env`);
}
