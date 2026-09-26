"use client";

import { useState } from "react";
import { erc20Abi, maxUint256, parseUnits } from "viem";
import { miniAmmAbi, sandwichLabAbi } from "@/lib/abi";
import { BASE, QUOTE, deployment, publicClient } from "@/lib/config";
import { useOnBlock } from "@/lib/hooks";
import { priceToTick, rawPriceToHuman } from "@/lib/price";
import { useWallet } from "@/lib/wallet";

interface Venue {
  clean: bigint;
  attacked: bigint;
  pnl: bigint;
}

/** Result of the last lab run on this chain: from the lab contract's events. */
function useLastRun() {
  const lab = deployment.sandwichLab;
  return useOnBlock(
    async (head) => {
      const count = await publicClient.readContract({ address: lab!, abi: sandwichLabAbi, functionName: "runCount" });
      if (count === 0n) return null;
      // The lab is a local/demo contract; its history is short, so scan from its deploy block in RPC-sized chunks.
      let amm: Venue | undefined;
      let met: Venue | undefined;
      for (let to = head; to >= deployment.deployBlock && (!amm || !met); to -= 1000n) {
        const from = to >= deployment.deployBlock + 999n ? to - 999n : deployment.deployBlock;
        const [a, b] = await Promise.all([
          publicClient.getContractEvents({ address: lab!, abi: sandwichLabAbi, eventName: "AmmSandwich", fromBlock: from, toBlock: to }),
          publicClient.getContractEvents({ address: lab!, abi: sandwichLabAbi, eventName: "MetronomeSandwich", fromBlock: from, toBlock: to }),
        ]);
        const la = a.at(-1)?.args;
        const lb = b.at(-1)?.args;
        if (!amm && la) amm = { clean: la.cleanCost!, attacked: la.attackedCost!, pnl: la.attackerPnl! };
        if (!met && lb) met = { clean: lb.cleanCost!, attacked: lb.attackedCost!, pnl: lb.attackerPnl! };
        if (from === deployment.deployBlock) break;
      }
      return amm && met ? { amm, met, runs: count } : null;
    },
    [],
    !!lab,
  );
}

// Recorded by `pnpm e2e:local` on Sep 25 (100k MON victim, 100k MON attacker). Shown where the lab isn't deployed.
const RECORDED = {
  amm: { bps: 527, pnl: 119.76 },
  met: { bps: 0, pnl: -2.5 },
};

const bps = (v: Venue) => (Number(v.attacked - v.clean) * 10_000) / Number(v.clean);
const usd = (x: bigint) => Number(x) / 10 ** QUOTE.decimals;

export default function LabPage() {
  const { trader } = useWallet();
  const { data: run } = useLastRun();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const amm = run ? { bps: bps(run.amm), pnl: usd(run.amm.pnl) } : RECORDED.amm;
  const met = run ? { bps: bps(run.met), pnl: usd(run.met.pnl) } : RECORDED.met;

  async function runLab() {
    if (!trader || !deployment.sandwichLab || !deployment.miniAmm) return;
    const lab = deployment.sandwichLab;
    setError(undefined);
    try {
      setBusy("Approving…");
      for (const token of [deployment.base, deployment.quote]) {
        const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [trader.address, lab] });
        if (allowance < maxUint256 / 2n) await trader.send({ address: token, abi: erc20Abi, functionName: "approve", args: [lab, maxUint256] });
      }
      setBusy("Attacking both venues…");
      const spot = await publicClient.readContract({ address: deployment.miniAmm, abi: miniAmmAbi, functionName: "spotPrice" });
      const size = parseUnits("100000", BASE.decimals);
      const r = await trader.send({ address: lab, abi: sandwichLabAbi, functionName: "run", args: [size, size, priceToTick(rawPriceToHuman(spot))] });
      const runId = (await publicClient.readContract({ address: lab, abi: sandwichLabAbi, functionName: "runCount" })) - 1n;
      setBusy("Settling the batch…");
      while ((await publicClient.getBlockNumber()) <= r.blockNumber) await new Promise((res) => setTimeout(res, 300));
      await trader.send({ address: lab, abi: sandwichLabAbi, functionName: "finish", args: [runId] });
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
          ? `Live result from the SandwichLab contract (run ${run.runs.toString()} on this chain): 100k MON victim, 100k MON attacker.`
          : "Recorded result from the local end-to-end test (100k MON victim, 100k MON attacker)."}{" "}
        The attacker&apos;s loss on Metronome is the taker fee.
      </p>

      {deployment.sandwichLab && (
        <section className="rounded-3xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Run it yourself</h2>
          <p className="mt-1 text-xs text-muted">
            One transaction attacks both venues; a second one settles the Metronome batch and reports. You play every role (maker, attacker,
            victim) with about 200k {BASE.symbol} and 6k {QUOTE.symbol}. Everything comes back to you at the end, but as a different mix of{" "}
            {BASE.symbol} and {QUOTE.symbol}, since the AMM leg really buys MON.
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
