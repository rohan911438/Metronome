"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { erc20Abi, maxUint256, parseEventLogs, parseUnits, type Hash, type Log } from "viem";
import { miniAmmAbi, mockErc20Abi, sandwichLabAbi } from "@/lib/abi";
import { BASE, LOG_CHUNK, QUOTE, explorerTx, lab, publicClient } from "@/lib/config";
import { priceToTick, rawPriceToHuman } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

interface Venue {
  clean: bigint;
  attacked: bigint;
  pnl: bigint;
}
interface LabRun {
  amm: Venue;
  met: Venue;
  runId: bigint;
  txs: Hash[];
}

/** Both venues' results for one run, from the lab's events (the run tx has AmmSandwich, the finish tx MetronomeSandwich). */
function decode(logs: Log[]): LabRun | null {
  const events = parseEventLogs({ abi: sandwichLabAbi, logs });
  const a = events.findLast((e) => e.eventName === "AmmSandwich");
  const b = events.findLast((e) => e.eventName === "MetronomeSandwich" && (!a || e.args.runId === a.args.runId));
  if (!a || !b || a.eventName !== "AmmSandwich" || b.eventName !== "MetronomeSandwich") return null;
  return {
    amm: { clean: a.args.cleanCost, attacked: a.args.attackedCost, pnl: a.args.attackerPnl },
    met: { clean: b.args.cleanCost, attacked: b.args.attackedCost, pnl: b.args.attackerPnl },
    runId: a.args.runId,
    txs: [a.transactionHash!, b.transactionHash!],
  };
}

/** Latest finished run: scans back from the head in RPC-sized chunks, at most SCAN_CHUNKS of them. */
const SCAN_CHUNKS = 40n;
async function latestRun(): Promise<LabRun | null> {
  if (!lab) return null;
  const head = await publicClient.getBlockNumber();
  const floor = head - SCAN_CHUNKS * LOG_CHUNK > lab.deployBlock ? head - SCAN_CHUNKS * LOG_CHUNK : lab.deployBlock;
  const logs: Log[] = [];
  for (let to = head; to >= floor; to -= LOG_CHUNK) {
    const from = to - LOG_CHUNK + 1n > floor ? to - LOG_CHUNK + 1n : floor;
    logs.unshift(...(await publicClient.getLogs({ address: lab.sandwichLab, fromBlock: from, toBlock: to })));
    const run = decode(logs);
    if (run) return run;
    if (from === floor) break;
  }
  return null;
}

// Recorded runs, shown when no recent run is in reach of the log scan: 100k MON victim, 100k MON attacker.
const RECORDED: Record<string, { amm: { bps: number; pnl: number }; met: { bps: number; pnl: number }; note: string; txs?: Hash[] }> = {
  testnet: {
    amm: { bps: 527, pnl: 119.76 },
    met: { bps: 0, pnl: -2.5 },
    note: "Recorded on Monad testnet on Oct 4",
    txs: [
      "0x12915a346f7d4199f954d7c26e35b5f7bf783997ddf7a1577c70292a7c209712",
      "0xa152acebf1f269c2efc30f80c02582f359d06322ded676bfac6da53264a66884",
    ],
  },
  other: { amm: { bps: 527, pnl: 119.76 }, met: { bps: 0, pnl: -2.5 }, note: "Recorded by the local end-to-end test on Sep 25" },
};

const bps = (v: Venue) => (Number(v.attacked - v.clean) * 10_000) / Number(v.clean);
const usd = (x: bigint) => Number(x) / 10 ** QUOTE.decimals;
const SIZE = parseUnits("100000", BASE.decimals);

export default function LabPage() {
  const { trader } = useWallet();
  const [run, setRun] = useState<LabRun | null>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => latestRun().then(setRun, () => setRun(null)), []);
  useEffect(() => void refresh(), [refresh]);

  const recorded = lab && lab.mintable ? RECORDED.testnet : RECORDED.other;
  const amm = run ? { bps: bps(run.amm), pnl: usd(run.amm.pnl) } : recorded.amm;
  const met = run ? { bps: bps(run.met), pnl: usd(run.met.pnl) } : recorded.met;
  const txs = run ? run.txs : recorded.txs;

  async function runLab() {
    if (!trader || !lab) return;
    const { sandwichLab, miniAmm } = lab;
    setError(undefined);
    try {
      const spot = await publicClient.readContract({ address: miniAmm, abi: miniAmmAbi, functionName: "spotPrice" });
      const tick = priceToTick(rawPriceToHuman(spot));
      if (lab.mintable) {
        // Test tokens: mint what the run needs (2 x 100k MON, the AMM and Metronome quote legs, plus slack).
        const needs: [typeof lab.base, bigint][] = [
          [lab.base, 2n * SIZE],
          [lab.quote, parseUnits("12000", QUOTE.decimals)],
        ];
        for (const [token, need] of needs) {
          const have = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] });
          if (have < need) {
            setBusy("Minting test tokens…");
            await trader.send({ address: token, abi: mockErc20Abi, functionName: "mint", args: [trader.address, need - have] });
          }
        }
      }
      setBusy("Approving…");
      for (const token of [lab.base, lab.quote]) {
        const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [trader.address, sandwichLab] });
        if (allowance < maxUint256 / 2n) await trader.send({ address: token, abi: erc20Abi, functionName: "approve", args: [sandwichLab, maxUint256] });
      }
      setBusy("Attacking both venues…");
      const r = await trader.send({ address: sandwichLab, abi: sandwichLabAbi, functionName: "run", args: [SIZE, SIZE, tick] });
      const runId = (await publicClient.readContract({ address: sandwichLab, abi: sandwichLabAbi, functionName: "runCount" })) - 1n;
      setBusy("Settling the batch…");
      while ((await publicClient.getBlockNumber()) <= r.blockNumber) await new Promise((res) => setTimeout(res, 300));
      const f = await trader.send({ address: sandwichLab, abi: sandwichLabAbi, functionName: "finish", args: [runId] });
      setRun(decode([...r.logs, ...f.logs]));
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sandwich lab</h1>
        <p className="mt-1 text-sm text-muted">
          The same attack on two venues. A bot buys just before the victim and sells just after. On an AMM the victim pays the price the bot pushed
          up. On Metronome all three orders land in the same batch and clear at one price, so there is nothing to push.
        </p>
        <Link href="/radar" className="mt-2 inline-block text-sm text-accent underline">
          MEV radar: who really trades WMON on Monad mainnet →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { name: "Typical AMM", v: amm, bad: true },
          { name: "Metronome", v: met, bad: false },
        ].map(({ name, v, bad }) => (
          <section key={name} className={`rounded-3xl border p-4 ${bad ? "border-sell/40 bg-sell/5" : "border-buy/40 bg-buy/5"}`}>
            <h2 className="text-sm font-semibold">{name}</h2>
            <div className={`tabular mt-3 font-mono text-3xl font-semibold ${bad ? "text-sell" : "text-buy"}`}>
              {v.bps > 0 ? `−${(v.bps / 100).toFixed(2)}%` : "0%"}
            </div>
            <p className="text-xs text-muted">victim overpaid</p>
            <div className="tabular mt-3 font-mono text-sm">
              {v.pnl >= 0 ? "+" : "−"}
              {Math.abs(v.pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })} {QUOTE.symbol}
            </div>
            <p className="text-xs text-muted">attacker profit</p>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">
        {run
          ? `Live result from the SandwichLab contract (run #${run.runId.toString()} on this chain)`
          : run === undefined
            ? `${recorded.note} (looking for a newer run…)`
            : recorded.note}: 100k MON victim, 100k
        MON attacker. The attacker&apos;s loss on Metronome is the taker fee.
        {txs &&
          explorerTx(txs[0]!) &&
          txs.map((h, i) => (
            <a key={h} href={explorerTx(h)} target="_blank" rel="noreferrer" className="ml-1 text-accent underline">
              {i === 0 ? "attack tx" : "settle tx"}
            </a>
          ))}
      </p>

      {lab && (
        <section className="rounded-3xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Run it yourself</h2>
          <p className="mt-1 text-xs text-muted">
            One transaction attacks both venues; a second one settles the Metronome batch and reports. You play every role (maker, attacker,
            victim) with about 200k {BASE.symbol} and 6k {QUOTE.symbol}.{" "}
            {lab.mintable
              ? "On testnet the lab runs on its own Metronome market with test tokens (tWMON/tAUSD) that the app mints for you, so you only need a little MON for gas."
              : `Everything comes back to you at the end, but as a different mix of ${BASE.symbol} and ${QUOTE.symbol}, since the AMM leg really buys MON.`}
          </p>
          <button
            disabled={!trader || !!busy}
            onClick={runLab}
            className="mt-3 w-full rounded-2xl bg-accent py-3.5 font-medium text-accent-fg disabled:opacity-40"
          >
            {!trader ? "Sign in first" : (busy ?? "Run the sandwich")}
          </button>
          {error && <p className="mt-2 break-words text-xs text-sell">{error}</p>}
        </section>
      )}
    </div>
  );
}
