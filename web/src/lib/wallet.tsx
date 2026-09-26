"use client";

/**
 * The trading account. Two kinds:
 *   - passkey: Mera. The passkey's PRF output derives the wallet key (and the Perpl API key, see keys.ts). The key
 *              lives only in an in-memory signing session; after a reload the user unlocks again with Face ID.
 *              Transactions are signed in-app, so trading never shows a wallet popup.
 *   - burner:  local chain only, a throwaway key kept in localStorage, for development and tests without a passkey.
 *
 * `send` sets a tight gas limit (estimate + 20%): Monad charges for the gas limit, not gas used.
 */
import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createWalletClient,
  http,
  type Abi,
  type Account,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chain, isLocal, publicClient, rpcUrl } from "./config";
import { deriveKeys, type DerivedKeys } from "./keys";

export interface WriteCall<abi extends Abi, name extends ContractFunctionName<abi, "nonpayable" | "payable">> {
  address: Address;
  abi: abi;
  functionName: name;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>;
  value?: bigint;
}

export interface Trader {
  address: Address;
  kind: "passkey" | "burner";
  send<const abi extends Abi, name extends ContractFunctionName<abi, "nonpayable" | "payable">>(
    call: WriteCall<abi, name>,
  ): Promise<TransactionReceipt>;
}

interface StoredCredential {
  credentialId: string;
  transports?: readonly string[];
  /** Address of the derived wallet, so a locked account can still be shown. */
  address?: Address;
}

interface WalletState {
  trader: Trader | null;
  /** Keys derived from the passkey (null for the local burner or while locked). */
  keys: DerivedKeys | null;
  /** A passkey was used on this device before: offer "unlock" rather than "create". */
  known: StoredCredential | null;
  /** WebAuthn is available in this browser. PRF support is only known after the first passkey call. */
  supported: boolean;
  busy: boolean;
  error?: string;
  create: () => Promise<void>;
  /** Unlock with the remembered passkey, or let the user pick any passkey for this site. */
  unlock: (anyPasskey?: boolean) => Promise<void>;
  lock: () => void;
  forget: () => void;
  useBurner: () => void;
}

const Ctx = createContext<WalletState | null>(null);
const CRED_KEY = "metronome.passkey";
const BURNER_KEY = "metronome.burner";

function makeTrader(account: Account, kind: Trader["kind"]): Trader {
  const client = createWalletClient({ account, chain, transport: http(rpcUrl) });
  return {
    address: account.address,
    kind,
    async send(call) {
      const params = { ...call, account } as never;
      const gas = await publicClient.estimateContractGas(params);
      const hash = await client.writeContract({ ...(params as object), chain, gas: (gas * 12n) / 10n } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${String(call.functionName)} reverted (${hash})`);
      return receipt;
    },
  };
}

const readJson = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const writeStorage = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage unavailable (private mode): the session still works, it just isn't remembered
  }
};

/** Mera errors carry a `code`; turn the common ones into something a user can act on. */
function explain(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === "PRF_UNAVAILABLE")
    return "This device's passkeys can't derive a wallet (no PRF support). Try Chrome, Safari on iOS 18+, or a recent Android phone.";
  if (code === "PASSKEY_OPERATION_FAILED") return "Passkey request was cancelled or failed. Try again.";
  return (e as Error).message?.split("\n")[0] ?? String(e);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [trader, setTrader] = useState<Trader | null>(null);
  const [keys, setKeys] = useState<DerivedKeys | null>(null);
  const [known, setKnown] = useState<StoredCredential | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const endSession = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
    setKnown(readJson<StoredCredential>(CRED_KEY));
    if (isLocal) {
      const k = readJson<Hex>(BURNER_KEY);
      if (k) setTrader(makeTrader(privateKeyToAccount(k), "burner"));
    }
  }, []);

  const start = useCallback((prfOutput: Uint8Array, credential: StoredCredential) => {
    const derived = deriveKeys(prfOutput);
    const session = createSecp256k1SigningSession({ privateKey: derived.walletKey(0) });
    endSession.current?.();
    endSession.current = () => session.end();
    const account = toViemAccount(session);
    const stored = { ...credential, address: account.address };
    writeStorage(CRED_KEY, JSON.stringify(stored));
    writeStorage(BURNER_KEY, null);
    setKnown(stored);
    setKeys(derived);
    setTrader(makeTrader(account, "passkey"));
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    () =>
      run(async () => {
        const created = await createPasskeyWithPrfOutput({
          rp: { id: location.hostname, name: "Metronome" },
          user: { name: `metronome-${new Date().toISOString().slice(0, 10)}`, displayName: "Metronome account" },
        });
        start(created.prfOutput, { credentialId: created.credentialId, transports: created.transports });
      }),
    [run, start],
  );

  const unlock = useCallback(
    (anyPasskey = false) =>
      run(async () => {
        const stored = anyPasskey ? null : readJson<StoredCredential>(CRED_KEY);
        const res = await getPasskeyPrfOutput({
          rpId: location.hostname,
          credential: stored ? { credentialId: stored.credentialId, transports: stored.transports as never } : undefined,
        });
        start(res.prfOutput, { credentialId: res.credentialId, transports: stored?.transports });
      }),
    [run, start],
  );

  const lock = useCallback(() => {
    endSession.current?.();
    endSession.current = null;
    setKeys(null);
    setTrader(null);
  }, []);

  const forget = useCallback(() => {
    lock();
    writeStorage(CRED_KEY, null);
    writeStorage(BURNER_KEY, null);
    setKnown(null);
  }, [lock]);

  const useBurner = useCallback(() => {
    const k = generatePrivateKey();
    writeStorage(BURNER_KEY, JSON.stringify(k));
    setKeys(null);
    setTrader(makeTrader(privateKeyToAccount(k), "burner"));
  }, []);

  useEffect(() => () => endSession.current?.(), []);

  const value = useMemo<WalletState>(
    () => ({ trader, keys, known, supported, busy, error, create, unlock, lock, forget, useBurner }),
    [trader, keys, known, supported, busy, error, create, unlock, lock, forget, useBurner],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
