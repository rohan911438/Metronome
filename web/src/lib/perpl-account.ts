/**
 * The user's Perpl exchange account, read and set up directly on-chain from their Metronome wallet. Setup is three
 * transactions: approve the collateral (AUSD), `createAccount(amount)` with the opening deposit, then
 * `allowOrderForwarding(true)` so orders sent with an API key can be forwarded (and paid for) by Perpl.
 *
 * Works wherever the app's chain is Perpl's chain: Monad testnet, or the local testnet fork (`pnpm perpl:fork`).
 */
import { erc20Abi, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { chain, publicClient } from "./config";
import { useOnBlock } from "./hooks";
import type { PerplContext } from "./perpl";
import type { Trader } from "./wallet";

export const perplExchangeAbi = parseAbi([
  "function createAccount(uint256 amountCNS) returns (uint256 accountId)",
  "function depositCollateral(uint256 amountCNS)",
  "function allowOrderForwarding(bool allow)",
  "function getAccountByAddr(address accountAddress) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256 bank1, uint256 bank2, uint256 bank3, uint256 bank4) positions))",
  "event OrderForwardingUpdated(uint256 accountId, bool allowed)",
]);

/** `getAccountByAddr` reverts with this selector (and the address) when the wallet has no account. Not in the ABI. */
const NO_ACCOUNT = "0x03a0e277";

export interface PerplSetup {
  exchange: Address;
  collateral: { address: Address; symbol: string; decimals: number };
  minOpen: bigint;
  minDeposit: bigint;
}

/** Perpl's contract addresses and limits, from its public context. Null if Perpl isn't on the app's chain. */
export function perplSetup(ctx: PerplContext | undefined): PerplSetup | null {
  const inst = ctx?.instances[0];
  const token = ctx?.tokens[0];
  if (!ctx || !inst || !token || ctx.chain.chain_id !== chain.id) return null;
  return {
    exchange: inst.address as Address,
    collateral: { address: token.address as Address, symbol: token.symbol, decimals: token.decimals },
    minOpen: BigInt(inst.min_account_open_amount),
    minDeposit: BigInt(inst.min_deposit_amount),
  };
}

export interface PerplAccountState {
  account: { id: bigint; balance: bigint; locked: bigint; frozen: number } | null;
  collateral: bigint;
  allowance: bigint;
  mon: bigint;
}

export function usePerplAccount(owner: Address | undefined, setup: PerplSetup | null) {
  return useOnBlock(
    async (): Promise<PerplAccountState> => {
      const s = setup!;
      const a = owner!;
      const [account, collateral, allowance, mon] = await Promise.all([
        publicClient
          .readContract({ address: s.exchange, abi: perplExchangeAbi, functionName: "getAccountByAddr", args: [a] })
          .then((r) => ({ id: r.accountId, balance: r.balanceCNS, locked: r.lockedBalanceCNS, frozen: r.frozen }))
          .catch((e: unknown) => {
            if (revertData(e)?.startsWith(NO_ACCOUNT)) return null;
            throw e;
          }),
        publicClient.readContract({ address: s.collateral.address, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
        publicClient.readContract({ address: s.collateral.address, abi: erc20Abi, functionName: "allowance", args: [a, s.exchange] }),
        publicClient.getBalance({ address: a }),
      ]);
      return { account, collateral, allowance, mon };
    },
    [owner, setup?.exchange],
    !!owner && !!setup,
  );
}

function revertData(e: unknown): Hex | undefined {
  for (let c = e as { data?: unknown; cause?: unknown } | undefined; c; c = c.cause as typeof c) {
    if (typeof c.data === "string" && c.data.startsWith("0x")) return c.data as Hex;
    if (c.data && typeof (c.data as { data?: unknown }).data === "string") return (c.data as { data: Hex }).data;
  }
  // viem puts the raw revert data in the message when it can't decode it against the ABI.
  return (e as Error)?.message?.match(/0x03a0e277[0-9a-fA-F]*/)?.[0] as Hex | undefined;
}

export type SetupStep = "approve" | "create" | "forwarding";
export const SETUP_STEPS: { id: SetupStep; label: string }[] = [
  { id: "approve", label: "Allow Perpl to take the deposit" },
  { id: "create", label: "Open the account with the deposit" },
  { id: "forwarding", label: "Turn on one-click trading" },
];

/**
 * Runs whatever setup steps are still missing, in order. Resumable: an existing account skips straight to forwarding.
 * `onStep` reports progress so the UI can show each transaction.
 */
export async function setUpPerplAccount(
  trader: Trader,
  setup: PerplSetup,
  state: PerplAccountState,
  deposit: bigint,
  onStep: (step: SetupStep, status: "pending" | "done" | "skipped", receipt?: TransactionReceipt) => void,
) {
  if (!state.account) {
    if (deposit < setup.minOpen) throw new Error("Deposit is below Perpl's minimum to open an account");
    if (state.collateral < deposit) throw new Error(`Not enough ${setup.collateral.symbol}`);
    // Approve exactly the deposit: no standing allowance for a third-party contract.
    if (state.allowance < deposit) {
      onStep("approve", "pending");
      const r = await trader.send({ address: setup.collateral.address, abi: erc20Abi, functionName: "approve", args: [setup.exchange, deposit] });
      onStep("approve", "done", r);
    } else onStep("approve", "skipped");
    onStep("create", "pending");
    const r = await trader.send({ address: setup.exchange, abi: perplExchangeAbi, functionName: "createAccount", args: [deposit] });
    onStep("create", "done", r);
  } else {
    onStep("approve", "skipped");
    onStep("create", "skipped");
  }
  onStep("forwarding", "pending");
  const r = await trader.send({ address: setup.exchange, abi: perplExchangeAbi, functionName: "allowOrderForwarding", args: [true] });
  rememberForwarding(setup.exchange, trader.address, true);
  onStep("forwarding", "done", r);
}

/**
 * The exchange has no getter for the forwarding flag, only an event. We remember what this device set; the card offers
 * "turn on" again otherwise, which is harmless if it's already on.
 */
const fwdKey = (exchange: Address, owner: Address) => `metronome.perpl.forwarding.${chain.id}.${exchange}.${owner}`.toLowerCase();
export function rememberForwarding(exchange: Address, owner: Address, on: boolean) {
  try {
    if (on) localStorage.setItem(fwdKey(exchange, owner), "1");
    else localStorage.removeItem(fwdKey(exchange, owner));
  } catch {
    // storage unavailable: the card will just offer the switch again
  }
}
export function forwardingRemembered(exchange: Address, owner: Address): boolean {
  try {
    return localStorage.getItem(fwdKey(exchange, owner)) === "1";
  } catch {
    return false;
  }
}
