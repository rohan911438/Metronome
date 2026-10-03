/**
 * MEV radar for Monad mainnet: who trades WMON, and does anyone get sandwiched?
 *
 * 1. Pull recent WMON DEX trades from Nansen (`tgm/dex-trades`, 1 credit per 1,000 trades, with Nansen's trader labels).
 * 2. Sandwich candidates: one trader buys and sells WMON against the same token within SANDWICH_WINDOW seconds, with
 *    someone else's trade on that pair in between. Each candidate is checked on Monad mainnet: all three transactions in
 *    one block, in front < victim < back order. Only verified sandwiches are reported.
 * 3. Bots: traders with a large share of the window's trades. Nansen's `first-funder` (1 credit each) shows who funded
 *    them, so bots run by one operator show up as one cluster.
 *
 * Writes web/public/radar.json for the /radar page. The API key stays server-side (bots/.env); the page only reads the
 * snapshot. Free Nansen plans get 10 credits a day, so a run is capped at RADAR_PAGES + RADAR_FUNDERS credits.
 *
 *   NANSEN_API_KEY=... pnpm radar            (RADAR_HOURS=6 RADAR_PAGES=5 RADAR_FUNDERS=4)
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Hash } from "viem";
import { monad } from "viem/chains";
import { isMain, log } from "./chain.js";
import "./config.js"; // loads bots/.env

const NANSEN = "https://api.nansen.ai/api/v1";
const WMON = "0x3bd359c1119da7da1d913d1c4d2b7c461115433a";
const SANDWICH_WINDOW = 2; // seconds; Monad blocks are ~0.4 s apart
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/public/radar.json");

export interface NansenTrade {
  block_timestamp: string;
  transaction_hash: Hash;
  trader_address: string;
  trader_address_label?: string | null;
  action: "BUY" | "SELL";
  token_amount: number;
  traded_token_address: string;
  traded_token_name: string;
  traded_token_amount: number;
  estimated_value_usd: number;
}

interface Trade extends NansenTrade {
  ts: number;
}

export interface Sandwich {
  attacker: string;
  label: string | null;
  pair: string;
  block: number;
  front: Hash;
  victim: Hash;
  back: Hash;
  victimUsd: number;
  profitUsd: number;
}

export interface Bot {
  address: string;
  label: string | null;
  trades: number;
  volumeUsd: number;
  funder?: { address: string; name: string | null } | null;
}

export interface Radar {
  generatedAt: string;
  token: { symbol: string; address: string; chain: string };
  window: { from: string; to: string };
  trades: number;
  volumeUsd: number;
  pairs: Record<string, number>;
  bots: Bot[];
  botTrades: number;
  botVolumeUsd: number;
  candidates: number;
  sandwiches: Sandwich[];
  credits: { used: number; remaining: number | null };
}

let creditsUsed = 0;
let creditsRemaining: number | null = null;

async function nansen<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.NANSEN_API_KEY;
  if (!key) throw new Error("set NANSEN_API_KEY in bots/.env");
  const res = await fetch(`${NANSEN}/${path}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  creditsUsed += Number(res.headers.get("x-nansen-credits-used") ?? 0);
  const left = res.headers.get("x-nansen-credits-remaining");
  if (left !== null) creditsRemaining = Number(left);
  const json = (await res.json()) as { message?: string };
  if (!res.ok) throw new Error(`Nansen ${path}: ${res.status} ${json.message ?? ""}`);
  return json as T;
}

async function fetchTrades(from: Date, to: Date, maxPages: number): Promise<Trade[]> {
  const out: Trade[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await nansen<{ data: NansenTrade[]; pagination: { is_last_page: boolean } }>("tgm/dex-trades", {
      chain: "monad",
      token_address: WMON,
      date: { from: from.toISOString(), to: to.toISOString() },
      pagination: { page, per_page: 1000 },
      order_by: [{ field: "block_timestamp", direction: "DESC" }],
    });
    out.push(...r.data.map((t) => ({ ...t, ts: Date.parse(t.block_timestamp) / 1000 })));
    log("radar", `page ${page}: ${r.data.length} trades (to ${r.data.at(-1)?.block_timestamp ?? "-"})`);
    if (r.pagination.is_last_page || r.data.length === 0) break;
  }
  return out;
}

/** Same trader, opposite sides, same pair, close in time, with another trader's trade on the pair in between. */
export function sandwichCandidates(trades: Trade[]) {
  const byTrader = new Map<string, Trade[]>();
  for (const t of trades) byTrader.set(t.trader_address, [...(byTrader.get(t.trader_address) ?? []), t]);
  const out: { front: Trade; back: Trade; victims: Trade[] }[] = [];
  for (const [addr, ts] of byTrader) {
    for (const front of ts)
      for (const back of ts) {
        if (front.action === back.action || front.transaction_hash === back.transaction_hash) continue;
        if (front.traded_token_address !== back.traded_token_address) continue;
        if (back.ts < front.ts || back.ts - front.ts > SANDWICH_WINDOW) continue;
        const victims = trades.filter(
          (v) =>
            v.trader_address !== addr &&
            v.traded_token_address === front.traded_token_address &&
            v.action === front.action && // the victim trades the same way as the front-run
            v.ts >= front.ts &&
            v.ts <= back.ts,
        );
        if (victims.length) out.push({ front, back, victims });
      }
  }
  return out;
}

async function verify(cands: ReturnType<typeof sandwichCandidates>): Promise<Sandwich[]> {
  const client = createPublicClient({ chain: monad, transport: http(process.env.MAINNET_RPC_URL) });
  const pos = new Map<string, { block: bigint; index: number }>();
  const where = async (h: Hash) => {
    if (!pos.has(h)) {
      const r = await client.getTransactionReceipt({ hash: h });
      pos.set(h, { block: r.blockNumber, index: r.transactionIndex });
    }
    return pos.get(h)!;
  };
  const found: Sandwich[] = [];
  for (const c of cands) {
    const [f, b] = [await where(c.front.transaction_hash), await where(c.back.transaction_hash)];
    if (f.block !== b.block || f.index >= b.index) continue;
    for (const v of c.victims) {
      const p = await where(v.transaction_hash);
      if (p.block !== f.block || p.index <= f.index || p.index >= b.index) continue;
      const [buy, sell] = c.front.action === "BUY" ? [c.front, c.back] : [c.back, c.front];
      found.push({
        attacker: c.front.trader_address,
        label: c.front.trader_address_label || null,
        pair: `WMON/${c.front.traded_token_name}`,
        block: Number(f.block),
        front: c.front.transaction_hash,
        victim: v.transaction_hash,
        back: c.back.transaction_hash,
        victimUsd: v.estimated_value_usd,
        profitUsd: sell.estimated_value_usd - buy.estimated_value_usd,
      });
    }
  }
  return found;
}

export async function runRadar(): Promise<Radar> {
  const hours = Number(process.env.RADAR_HOURS ?? 6);
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const trades = await fetchTrades(from, to, Number(process.env.RADAR_PAGES ?? 5));
  if (trades.length === 0) throw new Error("Nansen returned no trades");

  const volume = (ts: Trade[]) => ts.reduce((s, t) => s + (t.estimated_value_usd || 0), 0);
  const byTrader = new Map<string, Trade[]>();
  for (const t of trades) byTrader.set(t.trader_address, [...(byTrader.get(t.trader_address) ?? []), t]);
  // A "bot" here: at least 2% of the window's trades and at least 20 of them.
  const minTrades = Math.max(20, Math.ceil(trades.length * 0.02));
  const bots: Bot[] = [...byTrader]
    .filter(([, ts]) => ts.length >= minTrades)
    .map(([address, ts]) => ({ address, label: ts[0]!.trader_address_label || null, trades: ts.length, volumeUsd: volume(ts) }))
    .sort((a, b) => b.trades - a.trades);
  for (const bot of bots.slice(0, Number(process.env.RADAR_FUNDERS ?? 4))) {
    try {
      const r = await nansen<{ data: { first_funder_address: string; first_funder_name?: string | null }[] }>(
        "profiler/address/first-funder",
        { address: bot.address, chain: "all" }, // this endpoint only accepts "all"
      );
      const f = r.data[0];
      bot.funder = f ? { address: f.first_funder_address, name: f.first_funder_name || null } : null;
    } catch (e) {
      log("radar", `first-funder ${bot.address}: ${(e as Error).message}`);
    }
  }
  const botSet = new Set(bots.map((b) => b.address));
  const botTrades = trades.filter((t) => botSet.has(t.trader_address));

  const cands = sandwichCandidates(trades);
  log("radar", `${trades.length} trades, ${bots.length} bots, ${cands.length} sandwich candidates; checking on-chain`);
  const sandwiches = await verify(cands);

  const pairs: Record<string, number> = {};
  for (const t of trades) pairs[t.traded_token_name || "?"] = (pairs[t.traded_token_name || "?"] ?? 0) + 1;
  const times = trades.map((t) => t.ts);
  return {
    generatedAt: new Date().toISOString(),
    token: { symbol: "WMON", address: WMON, chain: "monad" },
    window: { from: new Date(Math.min(...times) * 1000).toISOString(), to: new Date(Math.max(...times) * 1000).toISOString() },
    trades: trades.length,
    volumeUsd: volume(trades),
    pairs,
    bots,
    botTrades: botTrades.length,
    botVolumeUsd: volume(botTrades),
    candidates: cands.length,
    sandwiches,
    credits: { used: creditsUsed, remaining: creditsRemaining },
  };
}

if (isMain(import.meta.url)) {
  const r = await runRadar();
  writeFileSync(OUT, JSON.stringify(r, null, 2) + "\n");
  log("radar", `wrote ${OUT}: ${r.trades} trades, ${r.sandwiches.length} sandwiches, ${r.credits.used} credits used (${r.credits.remaining} left)`);
}
