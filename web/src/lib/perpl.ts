/**
 * Perpl (onchain perpetual futures on Monad): public market data, read through our pass-through route
 * (app/api/perpl). Perpl is on Monad testnet for every app network except mainnet, since there is no Perpl on Anvil.
 *
 * Wire units: prices and sizes are integers scaled by the market's `price_decimals` / `size_decimals`; amounts are
 * decimal strings in collateral-token units (AUSD, 6 decimals); fees and funding rates are micros (10^-6).
 */
import { usePoll } from "./poll";

export { usePoll };

const API = "/api/perpl/v1";

export interface BlockTimestamp {
  b: number;
  t: number;
}

export interface MarketState {
  at: BlockTimestamp;
  orl: number;
  mrk: number;
  lst: number;
  mid: number;
  bid: number;
  ask: number;
  prv: number;
  dv: number;
  dva: string;
  oi: number;
  tvl: string;
}

export interface FundingEvent {
  at: BlockTimestamp;
  rate: number;
  idx: number;
}

export interface PerplMarket {
  id: number;
  symbol: string;
  name: string;
  funding_interval_sec: number;
  config: { is_open: boolean; price_decimals: number; size_decimals: number; maker_fee: number; taker_fee: number };
  state?: MarketState;
  funding?: FundingEvent;
}

export interface PerplContext {
  chain: { chain_id: number; name: string };
  instances: { address: string; min_account_open_amount: string; min_deposit_amount: string }[];
  tokens: { address: string; symbol: string; decimals: number }[];
  markets: PerplMarket[];
}

export interface BookLevel {
  p: number;
  s: number;
  o: number;
}
export interface Book {
  at: BlockTimestamp;
  bid: BookLevel[];
  ask: BookLevel[];
}

export interface Candle {
  t: number;
  o: number;
  c: number;
  h: number;
  l: number;
  v: string;
  n: number;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/${path}`, { cache: "no-store" });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Perpl ${r.status}${msg ? `: ${msg.slice(0, 120)}` : ""}`);
  }
  return r.json() as Promise<T>;
}

export const perpl = {
  context: () => get<PerplContext>("pub/context"),
  tickers: () => get<{ d: Record<string, MarketState> }>("market-data/ticker").then((r) => r.d),
  book: (market: number, levels = 12) => get<Book>(`market-data/${market}/book?levels=${levels}`),
  /** Candles covering the last `count` periods; `to` is rounded to the period so the server cache is shared. */
  candles(market: number, resolution: number, count: number) {
    const step = resolution * 1000;
    const to = Math.ceil(Date.now() / step) * step;
    return get<{ d: Candle[] }>(`market-data/${market}/candles/${resolution}/${to - count * step}-${to}`).then((r) => r.d);
  },
};

/** Integer on the wire → number, e.g. a price with 5 decimals. */
export const scaled = (v: number, decimals: number) => v / 10 ** decimals;
/** Decimal-string amount in collateral units → number. */
export const amount = (v: string, decimals = 6) => Number(v) / 10 ** decimals;

/** Show MON first, then the rest in Perpl's order; hide closed markets. */
export const sortMarkets = (ms: PerplMarket[]) =>
  ms.filter((m) => m.config.is_open).sort((a, b) => Number(b.symbol === "MON") - Number(a.symbol === "MON"));

export function fmtNum(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (a > 0 && a < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

/** A price at the market's own precision, with thousands separators. */
export const fmtPerpPrice = (raw: number, decimals: number) =>
  scaled(raw, decimals).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** "43 min", "8 h" */
export function fmtInterval(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} h`;
  return `${Math.round(sec / 60)} min`;
}
