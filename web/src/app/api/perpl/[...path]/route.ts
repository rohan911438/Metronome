/**
 * Pass-through for Perpl's public REST API. Perpl sends no CORS headers and its market-data WebSocket refuses browser
 * origins it hasn't whitelisted (HTTP 403), so the app reads public market data through this route instead.
 *
 * Only public, read-only paths are forwarded. Responses are cached for a moment, so any number of open apps cost Perpl
 * one upstream request per path per TTL.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.PERPL_API_URL ??
  (process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "https://app.perpl.xyz/api" : "https://testnet.perpl.xyz/api");

/** Allowed paths and how long (ms) each is cached. */
const ROUTES: [RegExp, number][] = [
  [/^v1\/pub\/context$/, 60_000],
  [/^v1\/market-data\/(\d+\/)?ticker$/, 1_000],
  [/^v1\/market-data\/\d+\/book$/, 1_000],
  [/^v1\/market-data\/\d+\/candles\/\d+\/\d+-\d+$/, 10_000],
  [/^v1\/market-data\/(\d+\/)?funding\/\d+-\d+$/, 30_000],
];

/** If Perpl is slow or failing, keep serving the last good answer for this long rather than an error. */
const STALE_MS = 60_000;

interface Reply {
  status: number;
  body: string;
}
const good = new Map<string, { at: number; body: string }>();
const inflight = new Map<string, Promise<Reply>>();

function fetchUpstream(url: string): Promise<Reply> {
  let p = inflight.get(url);
  if (p) return p; // a slow upstream call is shared, not repeated
  p = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    .then(async (r) => ({ status: r.status, body: await r.text() }))
    .catch((e: Error) => ({ status: 502, body: JSON.stringify({ error: `Perpl unreachable: ${e.message}` }) }))
    .then((r) => {
      const now = Date.now();
      if (r.status === 200) good.set(url, { at: now, body: r.body });
      if (good.size > 500) for (const [k, v] of good) if (now - v.at > STALE_MS) good.delete(k);
      return r;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

const json = (body: string, status = 200, stale = false) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(stale ? { "x-perpl-stale": "1" } : {}) },
  });

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  const ttl = ROUTES.find(([re]) => re.test(path))?.[1];
  if (ttl === undefined) return Response.json({ error: "not a public Perpl path" }, { status: 404 });

  const levels = req.nextUrl.searchParams.get("levels");
  const url = `${UPSTREAM}/${path}${levels && /^\d{1,3}$/.test(levels) ? `?levels=${levels}` : ""}`;

  const last = good.get(url);
  if (last && Date.now() - last.at <= ttl) return json(last.body);
  const r = await fetchUpstream(url);
  if (r.status === 200) return json(r.body);
  if (last && Date.now() - last.at <= STALE_MS) return json(last.body, 200, true);
  return json(r.body, r.status);
}
