/**
 * Reads from the Envio indexer (indexer/, served as GraphQL by Hasura). Optional: pages that use it say so when it
 * isn't configured or reachable, and the rest of the app reads the chain directly over RPC.
 *
 * NEXT_PUBLIC_INDEXER_URL sets the endpoint; on the local chain it defaults to the docker-compose Hasura.
 */
import { isLocal } from "./config";

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || (isLocal ? "http://localhost:8080/v1/graphql" : "");

export async function gql<T>(query: string): Promise<T> {
  if (!INDEXER_URL) throw new Error("No indexer configured (NEXT_PUBLIC_INDEXER_URL)");
  const r = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Indexer HTTP ${r.status}`);
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(`Indexer: ${j.errors[0]!.message}`);
  return j.data!;
}

/** Hasura returns BigInt/numeric columns as strings (HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES). */
type Big = string;

export interface IndexedStats {
  orders: number;
  takerOrders: number;
  restingOrders: number;
  traders: number;
  batchesSettled: number;
  batchesWithTrades: number;
  voidedBatches: number;
  volumeBase: Big;
  volumeQuote: Big;
  claims: number;
  cancels: number;
  keeperRewards: Big;
  settleDelayBlocksSum: Big;
  settleDelaySamples: number;
  gasPlaceSum: Big;
  gasPlaceTxs: number;
  gasSettleSum: Big;
  gasSettleTxs: number;
  gasClaimSum: Big;
  gasClaimTxs: number;
  gasCancelSum: Big;
  gasCancelTxs: number;
  lastBlock: number;
  lastTimestamp: number;
}

export interface StatsPage {
  Stats: IndexedStats[];
  DailyStats: { id: string; dayStart: number; volumeQuote: Big; volumeBase: Big; batchesWithTrades: number; orders: number }[];
  Keeper: { id: string; batchesSettled: number; rewards: Big }[];
  Batch: { id: Big; clearingTick: number; volume: Big; settledAt: number | null }[];
}

export const loadStatsPage = () =>
  gql<StatsPage>(`{
    Stats(where: { id: { _eq: "global" } }) {
      orders takerOrders restingOrders traders batchesSettled batchesWithTrades voidedBatches volumeBase volumeQuote
      claims cancels keeperRewards settleDelayBlocksSum settleDelaySamples gasPlaceSum gasPlaceTxs gasSettleSum
      gasSettleTxs gasClaimSum gasClaimTxs gasCancelSum gasCancelTxs lastBlock lastTimestamp
    }
    DailyStats(order_by: { dayStart: desc }, limit: 30) { id dayStart volumeQuote volumeBase batchesWithTrades orders }
    Keeper(order_by: { batchesSettled: desc }, limit: 5) { id batchesSettled rewards }
    Batch(where: { volume: { _gt: "0" }, voided: { _eq: false } }, order_by: { id: desc }, limit: 120) {
      id clearingTick volume settledAt
    }
  }`);
