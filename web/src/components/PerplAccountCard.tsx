"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { chain, explorerTx, isFork } from "@/lib/config";
import type { PerplContext } from "@/lib/perpl";
import {
  SETUP_STEPS,
  forwardingRemembered,
  perplSetup,
  setUpPerplAccount,
  usePerplAccount,
  type SetupStep,
} from "@/lib/perpl-account";
import { checkApiKey, forgetApiKey, loadApiKey, parseApiKey, saveApiKey, type KeyCheck, type PerplApiKey } from "@/lib/perpl-key";
import { fmtAmount, shortAddr } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

/** Keep this much MON for gas: three setup transactions cost well under it on Monad. */
const GAS_NEEDED = parseUnits("0.1", 18);

type StepState = { status: "pending" | "done" | "skipped"; hash?: Hex };

export function PerplAccountCard({ ctx }: { ctx: PerplContext | undefined }) {
  const { trader, keys } = useWallet();
  const setup = perplSetup(ctx);
  const { data: st, error } = usePerplAccount(trader?.address, setup);
  const [amount, setAmount] = useState("");
  const [steps, setSteps] = useState<Partial<Record<SetupStep, StepState>>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string>();
  const [forwarding, setForwarding] = useState(false);

  useEffect(() => {
    if (setup && trader) setForwarding(forwardingRemembered(setup.exchange, trader.address));
  }, [setup?.exchange, trader?.address, st?.account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return null;
  const token = ctx.tokens[0]!;
  const minOpen = BigInt(ctx.instances[0]!.min_account_open_amount);
  const fmt = (v: bigint) => `${fmtAmount(v, token.decimals)} ${token.symbol}`;
  const onPerplChain = ctx.chain.chain_id === chain.id;

  let body: React.ReactNode;
  if (!onPerplChain) {
    body = (
      <p>
        Perpl runs on {ctx.chain.name}. This build of the app is on {chain.name}, so account setup is off here. Run it on testnet, or on the
        local testnet fork (<code className="font-mono">pnpm perpl:fork</code>).
      </p>
    );
  } else if (!trader) {
    body = <p>Sign in with your passkey to open a Perpl account from this app. Opening one takes at least {fmt(minOpen)}.</p>;
  } else if (!st || !setup) {
    body = error ? <p className="text-sell">Couldn&apos;t read your Perpl account: {error}</p> : <p>Checking your Perpl account…</p>;
  } else if (st.account && !running && !runError && Object.keys(steps).length === 0) {
    body = (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span>
            Account <span className="tabular font-mono text-fg">#{st.account.id.toString()}</span>
          </span>
          <span className="tabular font-mono text-fg">{fmt(st.account.balance)}</span>
        </div>
        {st.account.locked > 0n && <p>{fmt(st.account.locked)} locked in open orders.</p>}
        {st.account.frozen !== 0 && <p className="text-sell">Perpl has frozen this account (status {st.account.frozen}).</p>}
        {forwarding ? (
          <p className="flex items-center gap-1.5">
            <Dot tone="buy" /> One-click trading is on (set from this device).
          </p>
        ) : (
          <button onClick={() => run(0n)} className="w-full rounded-2xl bg-accent py-2.5 text-sm font-medium text-accent-fg">
            Turn on one-click trading
          </button>
        )}
      </div>
    );
  } else if (!st.account && st.collateral < minOpen && !running) {
    body = (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-fg">{fmt(minOpen)} required to activate Perpl trading on testnet.</p>
        <p>
          Your wallet has <span className="tabular font-mono text-fg">{fmt(st.collateral)}</span>, which isn&apos;t enough.{" "}
          {st.mon >= GAS_NEEDED ? (
            <>Your testnet MON is enough for gas.</>
          ) : (
            <>
              You&apos;ll also need a little MON for gas (you have {fmtAmount(st.mon, 18)}).
            </>
          )}
        </p>
        <p>
          Send {token.symbol} to <span className="font-mono text-fg">{shortAddr(trader.address)}</span> on {ctx.chain.name}
          {isFork ? " (or use “Get test funds” in the account sheet on this fork)" : ""}.
        </p>
      </div>
    );
  } else {
    const deposit = parseAmount(amount, token.decimals) ?? minOpen;
    const tooSmall = !st.account && deposit < minOpen;
    const tooBig = !st.account && deposit > st.collateral;
    const lowGas = st.mon < GAS_NEEDED;
    body = (
      <div className="space-y-3">
        {!st.account && (
          <label className="block">
            <span className="text-[11px]">Opening deposit (you have {fmt(st.collateral)})</span>
            <div className="mt-1 flex items-center rounded-2xl bg-surface-2 px-3">
              <input
                inputMode="decimal"
                disabled={running}
                value={amount}
                placeholder={formatUnits(minOpen, token.decimals)}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="tabular w-full bg-transparent py-2.5 font-mono text-base text-fg outline-none"
                aria-label={`Deposit in ${token.symbol}`}
              />
              <span className="text-xs">{token.symbol}</span>
            </div>
            {tooSmall && <span className="mt-1 block text-sell">Perpl&apos;s minimum is {fmt(minOpen)}.</span>}
            {tooBig && <span className="mt-1 block text-sell">That&apos;s more than your balance.</span>}
          </label>
        )}
        <ol className="space-y-1.5">
          {SETUP_STEPS.map((s, i) => {
            const state = steps[s.id];
            const url = state?.hash ? explorerTx(state.hash) : undefined;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    state?.status === "done" || state?.status === "skipped"
                      ? "bg-buy text-accent-fg"
                      : state?.status === "pending"
                        ? "pulse-dot bg-accent text-accent-fg"
                        : "bg-surface-2"
                  }`}
                >
                  {state?.status === "done" || state?.status === "skipped" ? "✓" : i + 1}
                </span>
                <span className={state?.status === "skipped" ? "line-through" : "text-fg"}>{s.label}</span>
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="ml-auto text-accent underline">
                    tx
                  </a>
                )}
              </li>
            );
          })}
        </ol>
        {runError && <p className="break-words text-sell">{runError}</p>}
        {lowGas && <p className="text-sell">You need a little MON for gas (you have {fmtAmount(st.mon, 18)}).</p>}
        {Object.values(steps).every((s) => s.status !== "pending") && steps.forwarding?.status === "done" ? (
          <button onClick={() => setSteps({})} className="w-full rounded-2xl bg-surface-2 py-2.5 text-sm text-fg">
            Done
          </button>
        ) : (
          <button
            disabled={running || tooSmall || tooBig || lowGas}
            onClick={() => run(deposit)}
            className="w-full rounded-2xl bg-accent py-2.5 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {running ? "Confirming…" : st.account ? "Turn on one-click trading" : `Open Perpl account with ${fmt(deposit)}`}
          </button>
        )}
      </div>
    );
  }

  async function run(deposit: bigint) {
    if (!trader || !setup || !st) return;
    setRunning(true);
    setRunError(undefined);
    setSteps({});
    try {
      await setUpPerplAccount(trader, setup, st, deposit, (step, status, receipt) =>
        setSteps((s) => ({ ...s, [step]: { status, hash: receipt?.transactionHash } })),
      );
      setForwarding(true);
    } catch (e) {
      setRunError((e as Error).message.split("\n")[0]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl border border-line bg-surface p-4 text-xs text-muted">
      <div>
        <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-fg">
          Your Perpl account
          {isFork && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">local fork</span>}
        </h2>
        {body}
      </div>
      {onPerplChain && trader && <ApiKeySection chainId={ctx.chain.chain_id} vaultKey={keys?.vaultKey} />}
    </section>
  );
}

function ApiKeySection({ chainId, vaultKey }: { chainId: number; vaultKey?: Uint8Array }) {
  const { trader } = useWallet();
  const owner = trader!.address;
  const [key, setKey] = useState<PerplApiKey | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [check, setCheck] = useState<KeyCheck | "checking">();
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string>();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (vaultKey ? loadApiKey(owner, vaultKey) : Promise.resolve(null)).then((k) => {
      if (!alive) return;
      setKey(k);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [owner, vaultKey]);

  useEffect(() => {
    if (!key) return setCheck(undefined);
    let alive = true;
    setCheck("checking");
    checkApiKey(key, chainId).then((c) => alive && setCheck(c));
    return () => {
      alive = false;
    };
  }, [key, chainId]);

  const save = async () => {
    setErr(undefined);
    try {
      const k = parseApiKey(token, secret);
      if (vaultKey) await saveApiKey(owner, vaultKey, k);
      setKey(k);
      setToken("");
      setSecret("");
      setAdding(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const status =
    check === "checking" ? (
      <>
        <Dot /> Checking with Perpl…
      </>
    ) : check?.ok ? (
      <>
        <Dot tone="buy" /> Perpl accepted this key.
      </>
    ) : check?.reason === "rejected" ? (
      <>
        <Dot tone="sell" /> Perpl rejected this key (revoked, expired, or a typo in the private key).
      </>
    ) : check?.reason === "scope" ? (
      <>
        <Dot tone="sell" /> This key isn&apos;t allowed to read your account. Make one with the Trade scope.
      </>
    ) : check ? (
      <>
        <Dot tone="sell" /> Couldn&apos;t reach Perpl to check the key: {check.detail}
      </>
    ) : null;

  return (
    <div className="border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-semibold text-fg">Perpl API key</h3>
      {!loaded ? (
        <p>Loading…</p>
      ) : key ? (
        <div className="space-y-1.5">
          <p>
            Key <span className="font-mono text-fg">{key.token.slice(0, 10)}…</span> · public key{" "}
            <span className="font-mono text-fg">
              {key.publicKey.slice(0, 8)}…{key.publicKey.slice(-6)}
            </span>
          </p>
          <p className="flex items-center gap-1.5">{status}</p>
          <p>{vaultKey ? "Stored encrypted with your passkey on this device." : "Test account: kept in memory only, gone on reload."}</p>
          <button
            onClick={() => {
              forgetApiKey(owner);
              setKey(null);
            }}
            className="text-sell underline"
          >
            Remove key from this device
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5">
            <Dot tone="warn" />
            <span>
              No API key yet. Creating one inside this app needs Perpl to allow this site (their origin whitelist), which is pending. For now, make
              a key at{" "}
              <a className="text-accent underline" href="https://testnet.perpl.xyz/apikeys" target="_blank" rel="noreferrer">
                testnet.perpl.xyz/apikeys
              </a>{" "}
              and paste it here.
            </span>
          </p>
          {adding ? (
            <div className="space-y-2">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="API key token (X-API-Key)"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl bg-surface-2 px-3 py-2 font-mono text-fg outline-none"
              />
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Private key (64 hex characters)"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl bg-surface-2 px-3 py-2 font-mono text-fg outline-none"
              />
              {err && <p className="text-sell">{err}</p>}
              <p>{vaultKey ? "The private key is encrypted with your passkey before it's saved, and never leaves this device." : "Test account: the key is kept in memory only."}</p>
              <div className="flex gap-2">
                <button onClick={save} className="flex-1 rounded-2xl bg-accent py-2 text-sm font-medium text-accent-fg">
                  Save key
                </button>
                <button onClick={() => setAdding(false)} className="rounded-2xl bg-surface-2 px-4 py-2 text-sm text-fg">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full rounded-2xl bg-surface-2 py-2 text-sm text-fg">
              Paste a Perpl API key
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ tone }: { tone?: "buy" | "sell" | "warn" }) {
  const bg = tone === "buy" ? "bg-buy" : tone === "sell" ? "bg-sell" : tone === "warn" ? "bg-warn" : "bg-muted";
  return <span className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${bg}`} />;
}

function parseAmount(s: string, decimals: number): bigint | null {
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
  try {
    return parseUnits(s, decimals);
  } catch {
    return null;
  }
}
