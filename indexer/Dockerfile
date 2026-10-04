# Envio ships Linux/macOS binaries only, so the indexer always runs in this container (also on Windows).
FROM node:24-slim

# psql is used by envio to dump/restore its effects cache. ca-certificates: envio's native HTTP client (RPC sync,
# HyperSync) verifies TLS against the system store, which the slim image leaves empty.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.15.0

WORKDIR /indexer
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# `envio start` runs codegen first, for the config ENVIO_CONFIG selects (config.yaml = testnet, config.local.yaml = Anvil).
CMD ["pnpm", "envio", "start"]
