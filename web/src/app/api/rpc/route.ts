/**
 * Same-origin JSON-RPC proxy for the testnet app. Browsers then need to reach only this site: public RPC hosts were
 * failing from some networks (DNS lookups, held requests, Monad's 15 requests/s per user limit), which froze the app.
 * From the server, each request tries the upstreams in order with a short timeout and moves on when one fails.
 *
 * Only the read and send methods the app uses are forwarded. A send is never retried after a timeout, since the first
 * upstream may already have broadcast it.
 */
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// thirdweb takes any batch size; Ankr rejects batches over 10 (the app sends at most 10).
const UPSTREAMS = ["https://10143.rpc.thirdweb.com", "https://rpc.ankr.com/monad_testnet", "https://testnet-rpc.monad.xyz"];
const READ_TIMEOUT_MS = 2_000; // the browser gives up on us after 5 s and goes direct
const SEND_TIMEOUT_MS = 8_000; // under the browser's 10 s send timeout, so a send is never raced elsewhere

const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_fillTransaction", // viem tries it before filling a transaction itself
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
]);

interface RpcRequest {
  method?: unknown;
  id?: unknown;
}

// The newest block number, shared by every open app for a moment: most traffic is "is there a new block?".
let head: { at: number; body: string } | undefined;
const HEAD_TTL_MS = 250;

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_NETWORK !== "testnet") return NextResponse.json({ error: "testnet only" }, { status: 404 });
  const body = await req.text();
  let parsed: RpcRequest | RpcRequest[];
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0 || calls.length > 20) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "1-20 calls per request" } }, { status: 400 });
  }
  const denied = calls.find((c) => typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (denied) {
    return NextResponse.json({ jsonrpc: "2.0", id: denied.id ?? null, error: { code: -32601, message: `Method not allowed: ${String(denied.method)}` } });
  }

  const single = !Array.isArray(parsed) ? parsed : undefined;
  if (single?.method === "eth_blockNumber" && head && Date.now() - head.at < HEAD_TTL_MS) {
    const { result } = JSON.parse(head.body) as { result: string };
    return NextResponse.json({ jsonrpc: "2.0", id: single.id, result });
  }

  const isSend = calls.some((c) => c.method === "eth_sendRawTransaction");
  let lastError = "no upstream answered";
  for (const url of UPSTREAMS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(isSend ? SEND_TIMEOUT_MS : READ_TIMEOUT_MS),
      });
      const text = await r.text();
      // Rate limited or down: try the next upstream. (A send that got a response was not broadcast twice.)
      if (r.status === 429 || r.status >= 500 || /requests limited|Too many requests|Batch size too large/i.test(text)) {
        lastError = `${new URL(url).host}: HTTP ${r.status}`;
        continue;
      }
      if (single?.method === "eth_blockNumber" && r.ok) head = { at: Date.now(), body: text };
      return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      lastError = `${new URL(url).host}: ${(e as Error).name}`;
      if (isSend && (e as Error).name === "TimeoutError") break; // may have been broadcast; let the app check
    }
  }
  return NextResponse.json({ jsonrpc: "2.0", id: single?.id ?? null, error: { code: -32603, message: `RPC unavailable (${lastError})` } }, { status: 502 });
}
