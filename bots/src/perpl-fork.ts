/**
 * `pnpm perpl:fork`: a local fork of Monad testnet plus the web app pointed at it, for testing flows against real
 * testnet contracts (Perpl account setup) without real testnet funds. In the app: sign in with a passkey or a test
 * account, then "Get test funds on this fork" in the account sheet gives 100 MON and 1,000 AUSD.
 *
 * Nothing here touches the real testnet: transactions go to the fork only.
 */
import { spawn } from "node:child_process";
import { createPublicClient, http } from "viem";
import { sleep } from "./anvil.js";

const PORT = Number(process.env.FORK_PORT ?? 8546);
const UPSTREAM = process.env.FORK_URL ?? "https://testnet-rpc.monad.xyz";
const RPC = `http://127.0.0.1:${PORT}`;

// Mine a block every second: the app refreshes on new blocks, and an auto-mine-only fork would sit still between txs.
// Cancun, not Prague: Prague's per-block EIP-2935 system call reads upstream state on every block, and one dropped
// connection to the public RPC then crashes anvil. Retries cover the ordinary state fetches.
const anvil = spawn(
  "anvil",
  ["--fork-url", UPSTREAM, "--port", String(PORT), "--block-time", "1", "--hardfork", "cancun", "--retries", "10", "--silent"],
  { stdio: "inherit" },
);
const client = createPublicClient({ transport: http(RPC) });
for (let i = 0; ; i++) {
  try {
    const id = await client.getChainId();
    console.log(`[fork] Monad testnet fork up at ${RPC} (chain ${id}, from block ${await client.getBlockNumber()})`);
    break;
  } catch {
    if (i > 60 || anvil.exitCode !== null) {
      console.error("[fork] anvil didn't start (is Foundry on PATH?)");
      process.exit(1);
    }
    await sleep(500);
  }
}

// One command string: pnpm is a .cmd shim on Windows, so it needs a shell.
const web = spawn("pnpm --filter @metronome/web dev", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_RPC_URL: RPC },
});

const stop = () => {
  web.kill();
  anvil.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", stop);
