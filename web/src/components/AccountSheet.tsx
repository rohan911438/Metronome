"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createWalletClient, erc20Abi, http, parseEther, parseUnits, toHex, type Address } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { mockErc20Abi } from "@/lib/abi";
import { BASE, QUOTE, chain, deployment, devChain, isFork, publicClient, rpcUrl } from "@/lib/config";
import { useBalances } from "@/lib/hooks";
import { walletPath } from "@/lib/keys";
import { fmtBase, fmtQuote, shortAddr } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

/** Sub-account indexes shown in the keys panel: the main wallet and two more on the same passkey. */
const SUB_ACCOUNTS = [0, 1, 2];

// Anvil account 0 (public test key). Only used on the local chain to fund test accounts.
const ANVIL_FUNDER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function fundLocal(to: `0x${string}`) {
  await publicClient.request({ method: "anvil_setBalance" as never, params: [to, `0x${parseEther("100").toString(16)}`] as never });
  const funder = createWalletClient({ account: privateKeyToAccount(ANVIL_FUNDER), chain, transport: http(rpcUrl) });
  for (const [token, amount] of [
    [deployment.base, parseUnits("500000", BASE.decimals)],
    [deployment.quote, parseUnits("20000", QUOTE.decimals)],
  ] as const) {
    const hash = await funder.writeContract({ address: token, abi: mockErc20Abi, functionName: "mint", args: [to, amount] });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

/**
 * Dev fork only: gas via anvil_setBalance, and AUSD moved from an address that holds it on the fork (AUSD has no public
 * mint and its balance slot isn't discoverable, so it can't be dealt). The Perpl exchange holds millions.
 */
const FORK_QUOTE_HOLDER: Address = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
/** Agora's testnet AUSD: the testnet market's quote asset and Perpl's collateral. */
const FORK_AUSD: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

async function fundFork(to: Address) {
  const rpc = (method: string, params: unknown[]) => publicClient.request({ method: method as never, params: params as never });
  await rpc("anvil_setBalance", [to, `0x${parseEther("100").toString(16)}`]);
  await rpc("anvil_setBalance", [FORK_QUOTE_HOLDER, `0x${parseEther("10").toString(16)}`]);
  await rpc("anvil_impersonateAccount", [FORK_QUOTE_HOLDER]);
  try {
    const holder = createWalletClient({ account: FORK_QUOTE_HOLDER, chain, transport: http(rpcUrl) });
    const hash = await holder.writeContract({
      address: FORK_AUSD,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, parseUnits("1000", 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  } finally {
    await rpc("anvil_stopImpersonatingAccount", [FORK_QUOTE_HOLDER]);
  }
}

/** Hosted testnet app: /api/faucet sends a new wallet gas MON and requests Agora's testnet AUSD for it. */
const hasFaucet = chain.testnet && !isFork && deployment.quote.toLowerCase() === FORK_AUSD.toLowerCase();

export function AccountSheet({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const { trader, keys, known } = w;
  const { data: bal } = useBalances(trader?.address);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string>();
  const [fundNote, setFundNote] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const subAccounts = useMemo(() => (keys ? SUB_ACCOUNTS.map((i) => privateKeyToAddress(toHex(keys.walletKey(i)))) : []), [keys]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Portal to <body>: the sticky header uses backdrop-filter, which would otherwise become the containing block of
  // this fixed overlay and squeeze it into the header.
  return createPortal(
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Account"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        {!trader ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{known ? "Welcome back" : "Trade with just your face"}</h2>
            <p className="text-sm text-muted">
              Your wallet is derived from a passkey on this device (Face ID, fingerprint or screen lock). No seed phrase, no popups, and nothing
              stored on a server.
            </p>
            {!w.supported && <p className="text-sm text-warn">This browser has no passkey support.</p>}
            {known ? (
              <>
                <button
                  disabled={w.busy || !w.supported}
                  onClick={() => w.unlock()}
                  className="w-full rounded-2xl btn-primary py-3.5 font-medium disabled:opacity-50"
                >
                  {w.busy ? "Waiting for passkey…" : `Unlock ${known.address ? shortAddr(known.address) : "account"}`}
                </button>
                <button disabled={w.busy} onClick={() => w.unlock(true)} className="w-full rounded-2xl bg-surface-2 py-3 text-sm">
                  Use a different passkey
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={w.busy || !w.supported}
                  onClick={w.create}
                  className="w-full rounded-2xl btn-primary py-3.5 font-medium disabled:opacity-50"
                >
                  {w.busy ? "Waiting for passkey…" : "Create account with a passkey"}
                </button>
                <button disabled={w.busy || !w.supported} onClick={() => w.unlock(true)} className="w-full rounded-2xl bg-surface-2 py-3 text-sm">
                  I already have a passkey
                </button>
              </>
            )}
            {devChain && (
              <button disabled={w.busy} onClick={w.useBurner} className="w-full py-2 text-xs text-muted underline">
                Use a local test account instead (dev only)
              </button>
            )}
            {w.error && <p className="text-sm text-sell">{w.error}</p>}
            <p className="text-center text-[11px] text-muted">
              Passkey accounts by{" "}
              <a className="underline" href="https://mera.category.xyz" target="_blank" rel="noreferrer">
                Mera
              </a>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl bg-surface-2 p-4">
              <div className="text-xs text-muted">{QUOTE.symbol} balance</div>
              <div className="tabular mt-1 font-mono text-3xl font-semibold">{bal ? fmtQuote(bal.quote) : "…"}</div>
              <div className="mt-2 flex gap-4 text-xs text-muted">
                <span className="tabular font-mono">
                  {bal ? fmtBase(bal.mon) : "…"} {BASE.native}
                </span>
                <span className="tabular font-mono">
                  {bal ? fmtBase(bal.base) : "…"} {BASE.symbol}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs text-muted">{trader.kind === "passkey" ? "Passkey wallet" : "Local test account"}</div>
              <button className="mt-1 break-all text-left font-mono text-sm" onClick={() => copy(trader.address)}>
                {trader.address} <span className="text-accent">{copied ? "copied" : "copy"}</span>
              </button>
            </div>

            {devChain ? (
              <div>
                <button
                  disabled={funding}
                  onClick={async () => {
                    setFunding(true);
                    setFundError(undefined);
                    try {
                      await (isFork ? fundFork : fundLocal)(trader.address);
                    } catch (e) {
                      setFundError((e as Error).message.split("\n")[0]);
                    } finally {
                      setFunding(false);
                    }
                  }}
                  className="w-full rounded-2xl btn-primary py-3 font-medium disabled:opacity-50"
                >
                  {funding
                    ? "Funding…"
                    : isFork
                      ? "Get test funds on this fork (100 MON, 1,000 AUSD)"
                      : `Get test funds (100 MON, 500k ${BASE.symbol}, 20k ${QUOTE.symbol})`}
                </button>
                {fundError && <p className="mt-2 break-words text-xs text-sell">{fundError}</p>}
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">
                <b className="text-fg">Add {QUOTE.symbol} or MON:</b> send them to the address above on {chain.name}. MON pays gas and is what you sell;{" "}
                {QUOTE.symbol} is what you buy with.
                {chain.testnet && (
                  <>
                    {" "}
                    Free testnet MON:{" "}
                    <a className="text-accent underline" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
                      faucet.monad.xyz
                    </a>
                    .
                  </>
                )}
                {hasFaucet && (
                  <>
                    <button
                      disabled={funding}
                      onClick={async () => {
                        setFunding(true);
                        setFundError(undefined);
                        setFundNote(undefined);
                        try {
                          // Our server pays the gas: a new passkey wallet has no MON to send its own request.
                          const r = await fetch("/api/faucet", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ address: trader.address }),
                          });
                          const j = (await r.json()) as { error?: string; mon?: string; ausd?: string; notes?: string[] };
                          if (!r.ok || j.error) throw new Error(j.error ?? `Faucet HTTP ${r.status}`);
                          const got = [j.mon && "0.1 MON for gas", j.ausd && `10,000 ${QUOTE.symbol}`].filter(Boolean).join(" and ");
                          setFundNote([got && `Sent ${got}.`, ...(j.notes ?? [])].filter(Boolean).join(" "));
                        } catch (e) {
                          setFundError((e as Error).message);
                        } finally {
                          setFunding(false);
                        }
                      }}
                      className="mt-3 w-full rounded-2xl btn-primary py-3 font-medium disabled:opacity-50"
                    >
                      {funding ? "Sending…" : `Get test MON for gas + 10,000 ${QUOTE.symbol}`}
                    </button>
                    <p className="mt-2 text-xs">Testnet AUSD is also Perpl&apos;s collateral, so it can open a Perpl account (100 AUSD minimum).</p>
                    {fundNote && <p className="mt-2 break-words text-xs text-buy">{fundNote}</p>}
                    {fundError && <p className="mt-2 break-words text-xs text-sell">{fundError}</p>}
                  </>
                )}
              </div>
            )}

            {keys && (
              <section className="rounded-2xl border border-line p-3">
                <button onClick={() => setShowKeys((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium">
                  One passkey, many keys <span className="text-muted">{showKeys ? "−" : "+"}</span>
                </button>
                {showKeys && (
                  <div className="mt-2 space-y-2 text-xs">
                    <p className="text-muted">
                      Every key below is re-derived from your passkey each time you unlock. None of them is stored anywhere. Sub-accounts are separate
                      wallets (and separate Perpl accounts, so separate margin), e.g. one for a trading bot; switching needs no popup.
                    </p>
                    <dl className="space-y-2">
                      {subAccounts.map((address, i) => {
                        const active = i === w.account;
                        return (
                          <div key={i}>
                            <dt className="flex items-center text-muted">
                              {i === 0 ? "Monad wallet" : `Sub-account ${i}`} · {walletPath(i)}
                              {active ? (
                                <span className="ml-auto rounded-full bg-accent/15 px-2 text-[11px] text-accent">in use</span>
                              ) : (
                                <button onClick={() => w.selectAccount(i)} className="ml-auto rounded-full bg-surface-2 px-2 text-[11px] text-fg">
                                  Switch
                                </button>
                              )}
                            </dt>
                            <dd className="break-all font-mono">{address}</dd>
                          </div>
                        );
                      })}
                      <div>
                        <dt className="text-muted">Perpl API key (Ed25519) · public</dt>
                        <dd className="break-all font-mono">{keys.perpl.publicKey}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </section>
            )}

            <div className="flex gap-2">
              {trader.kind === "passkey" && (
                <button
                  onClick={() => {
                    w.lock();
                    onClose();
                  }}
                  className="flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm"
                >
                  Lock
                </button>
              )}
              <button
                onClick={() => {
                  w.forget();
                  onClose();
                }}
                className="flex-1 py-2.5 text-sm text-muted"
              >
                {trader.kind === "passkey" ? "Sign out of this device" : "Forget test account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
