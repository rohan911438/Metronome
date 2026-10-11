/**
 * Pass-through for Perpl's public REST API. Perpl sends no CORS headers and its market-data WebSocket refuses browser
 * origins it hasn't whitelisted (HTTP 403), so the app reads public market data through this route instead.
 *
 * Only public, read-only paths are forwarded, plus three read-only account paths signed by the user's API key.
 * Public responses are cached for a moment, so any number of open apps cost Perpl one upstream request per path per
 * TTL.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
// Perpl's trading API answers US requests with HTTP 451, and Vercel's default region is in the US.
export const preferredRegion = "bom1";

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

/**
 * Read-only account paths of Perpl's trading API. Users don't bring a key: the app's own key (PERPL_API_KEY plus its
 * Ed25519 secret PERPL_API_SECRET, server-only env vars) signs them here. A request that arrives already signed is
 * passed through untouched. Never cached.
 */
const SIGNED = /^v1\/trading\/(wallet|positions|orders)$/;
const SIGNED_HEADERS = ["x-api-key", "x-api-timestamp", "x-api-nonce", "x-api-signature"];

/** Perpl's signature: Ed25519 over `chain_id \n METHOD \n target \n timestamp_ms \n nonce \n sha256(body) hex`. */
async function serverSignature(target: string): Promise<Record<string, string> | null> {
  const token = process.env.PERPL_API_KEY;
  const secret = process.env.PERPL_API_SECRET?.trim().replace(/^0x/i, "");
  if (!token || !secret || !/^[0-9a-fA-F]{64}$/.test(secret)) return null;
  const ctx = await fetchUpstream(`${UPSTREAM}/v1/pub/context`);
  const chainId = (JSON.parse(ctx.body) as { chain?: { chain_id?: number } }).chain?.chain_id;
  if (!chainId) return null;
  const timestamp = Date.now().toString();
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  const canonical = [chainId, "GET", target, timestamp, nonce, bytesToHex(sha256(new Uint8Array()))].join("\n");
  const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(canonical), hexToBytes(secret.toLowerCase()))).toString("base64url");
  return { "x-api-key": token, "x-api-timestamp": timestamp, "x-api-nonce": nonce, "x-api-signature": signature };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (SIGNED.test(path)) {
    let headers: Record<string, string> | null = Object.fromEntries(SIGNED_HEADERS.map((h) => [h, req.headers.get(h) ?? ""]));
    if (Object.values(headers).some((v) => !v)) headers = await serverSignature(`/${path}`);
    if (!headers) return Response.json({ error: "Perpl API key not configured on the server" }, { status: 503 });
    const r = await fetch(`${UPSTREAM}/${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) })
      .then(async (u) => ({ status: u.status, body: await u.text() }))
      .catch((e: Error) => ({ status: 502, body: JSON.stringify({ error: `Perpl unreachable: ${e.message}` }) }));
    return json(r.body, r.status);
  }
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
