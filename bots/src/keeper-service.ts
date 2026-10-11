/**
 * The keeper as a web service (Render): runs the Keeper and answers GET /health with its status.
 *
 * Free web services sleep when no requests arrive, so the web app pings /health while it is open; that wakes the
 * keeper, and it settles whatever is pending (it re-scans BACKFILL blocks on start).
 */
import { createServer } from "node:http";
import { Keeper } from "./keeper.js";
import { log } from "./chain.js";
import { createCtx, keyFromEnv, walletFor } from "./config.js";

const ctx = createCtx();
const wallet = walletFor(ctx, keyFromEnv("KEEPER_PRIVATE_KEY"));
const keeper = new Keeper(ctx, wallet);
const startedAt = new Date().toISOString();
let ready = false;

createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.url === "/" || req.url?.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        ready,
        network: ctx.network,
        market: ctx.deployment.address,
        keeper: wallet.account.address,
        startedAt,
        ...keeper.summary(),
      }),
    );
    return;
  }
  res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 10000), () => log("keeper", `http on :${process.env.PORT ?? 10000}`));

await keeper.start();
ready = true;
setInterval(() => log("keeper", keeper.summary()), 60_000);
