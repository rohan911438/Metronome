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
import { fmtAmount, shortAddr } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

/** Keep this much MON for gas: three setup transactions cost well under it on Monad. */
const GAS_NEEDED = parseUnits("0.1", 18);

type StepState = { status: "pending" | "done" | "skipped"; hash?: Hex };

export function PerplAccountCard({ ctx }: { ctx: PerplContext | undefined }) {
  const { trader } = useWallet();
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
          <button onClick={() => run(0n)} className="w-full rounded-2xl btn-primary py-2.5 text-sm font-medium">
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
            className="w-full rounded-2xl btn-primary py-2.5 text-sm font-medium disabled:opacity-50"
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
    <section className="space-y-4 card p-4 text-xs text-muted">
      <div>
        <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-fg">
          Your Perpl account
          {isFork && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">local fork</span>}
        </h2>
        {body}
      </div>
      {onPerplChain && <PerplApiSection />}
    </section>
  );
}

/**
 * Perpl's trading API, through the app's own key: the server signs every request (app/api/perpl), so users never make
 * or paste a key. Shows that the API answers and which Perpl account the app's key belongs to.
 */
function PerplApiSection() {
  const [state, setState] = useState<{ ok: true; account?: number; addr?: string } | { ok: false; detail: string }>();

  useEffect(() => {
    let alive = true;
    fetch("/api/perpl/v1/trading/wallet", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 503 ? "not configured" : `HTTP ${r.status}`);
        const j = (await r.json()) as { addr?: string; as?: { id?: number }[] };
        if (alive) setState({ ok: true, account: j.as?.[0]?.id, addr: j.addr });
      })
      .catch((e: Error) => alive && setState({ ok: false, detail: e.message }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-semibold text-fg">Perpl API</h3>
      <p className="flex items-start gap-1.5">
        {!state ? (
          <>
            <Dot /> Checking Perpl&apos;s trading API…
          </>
        ) : state.ok ? (
          <>
            <Dot tone="buy" />
            <span>
              Connected through Metronome&apos;s API key, signed on our server{state.account ? ` (Perpl account #${state.account})` : ""}. Nothing to set
              up: your trades go on-chain from your own wallet.
            </span>
          </>
        ) : (
          <>
            <Dot tone="sell" /> Perpl&apos;s trading API is unreachable right now ({state.detail}). Trading still works on-chain.
          </>
        )}
      </p>
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
