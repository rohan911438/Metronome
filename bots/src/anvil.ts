/** Shared helpers for running the full stack on a local Anvil chain (e2e test and `pnpm dev:local`). */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";

// Anvil's default accounts 0-5 (mnemonic "test test ... junk"); test-only keys.
export const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts Anvil (1 s blocks) and deploys contracts/script/DeployLocal.s.sol. Returns the Anvil process. */
export async function startLocalStack(port: number): Promise<ChildProcess> {
  const anvil = spawn("anvil", ["--port", String(port), "--block-time", "1", "--silent"], { stdio: "ignore" });
  try {
    await sleep(1500);
    execFileSync(
      "forge",
      ["script", "script/DeployLocal.s.sol", "--rpc-url", `http://127.0.0.1:${port}`, "--broadcast", "--private-key", KEYS[0]!],
      { cwd: contractsDir, stdio: "ignore" },
    );
    return anvil;
  } catch (e) {
    anvil.kill();
    throw e;
  }
}
