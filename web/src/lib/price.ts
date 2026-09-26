import { formatUnits } from "viem";
import { BASE, QUOTE, deployment } from "./config";

export const MAX_TICK = 4095;
const PRICE_SCALE = 1e36;
const RAW_TO_HUMAN = 10 ** (BASE.decimals - QUOTE.decimals) / PRICE_SCALE;

/** Tick → price in AUSD per MON (float, for display). Each tick is +0.1%. */
export function tickToPrice(tick: number): number {
  return Number(deployment.priceMin) * 1.001 ** tick * RAW_TO_HUMAN;
}

/** Price in AUSD per MON → nearest tick. */
export function priceToTick(price: number): number {
  const t = Math.round(Math.log(price / (Number(deployment.priceMin) * RAW_TO_HUMAN)) / Math.log(1.001));
  return Math.min(MAX_TICK, Math.max(0, t));
}

/** Contract `price` value (raw quote per raw base, 1e36-scaled) → AUSD per MON. */
export const rawPriceToHuman = (raw: bigint) => Number(raw) * RAW_TO_HUMAN;

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}

/** Token amount with thousands separators and at most `dp` decimals. */
export function fmtAmount(raw: bigint, decimals: number, dp = 2): string {
  const n = Number(formatUnits(raw, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? Math.max(dp, 4) : dp });
}

export const fmtBase = (raw: bigint, dp = 2) => fmtAmount(raw, BASE.decimals, dp);
export const fmtQuote = (raw: bigint, dp = 2) => fmtAmount(raw, QUOTE.decimals, dp);

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
