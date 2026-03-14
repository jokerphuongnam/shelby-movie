# ShelbyMovie

Decentralised cinema platform on the Aptos blockchain + Shelby Protocol.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, TailwindCSS, Petra Wallet |
| API Gateway | Express, TypeScript, MongoDB, Aptos SDK |
| Stream Node | Express, TypeScript, Redis, NATS |
| Infrastructure | nginx, MongoDB, Redis, NATS |
| Blockchain | Aptos (testnet/mainnet) + Shelby Protocol |

---

## Quick Start

### Prerequisites

- Docker Desktop ≥ 4.x
- Node.js ≥ 20 + pnpm (for local dev)

### 1. Start all containers

```bash
./setup.sh                          # verifies Docker + creates .env files
docker compose up --build           # first time
docker compose up                   # subsequent starts
```

### 2. Seed the database

Run once after the first `docker compose up`:

```bash
# Option A — via Docker (no local Node needed)
docker exec -it api-gateway \
  node dist-scripts/scripts/seed.js

# Option B — locally (requires pnpm install first)
cd apps/api-gateway
MONGO_URI=mongodb://localhost:27017/shelbymovie pnpm seed
```

To re-seed from scratch (drops existing data):

```bash
docker exec -it mongodb mongosh shelbymovie --eval 'db.movies.drop()'
# then run seed again
```

### 3. Open the app

| URL | Description |
|-----|-------------|
| http://localhost | Frontend (via nginx) |
| http://localhost/health | API health check |
| http://localhost/api/movies/home | Home data (JSON) |

---

## Accessing from Another Device (IP-based)

### Find your machine's IP

**macOS**
```bash
ipconfig getifaddr en0          # Wi-Fi
ipconfig getifaddr en1          # Ethernet
```

**Windows**
```powershell
ipconfig                        # look for "IPv4 Address" under your active adapter
```

The IP will look like `192.168.x.x` or `10.x.x.x`.

### Update the frontend

Edit `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://192.168.1.100
NEXT_PUBLIC_STREAM_URL=http://192.168.1.100
```

Rebuild after changing env vars:

```bash
docker compose up --build frontend
```

### Wallet Troubleshooting (HTTP / Non-HTTPS)

Petra Wallet and modern browsers block mixed-content and insecure WebAuthn on plain HTTP when the origin is not `localhost`.

**Chrome — allow insecure origin:**

1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add your IP: `http://192.168.1.100`
3. Click **Enable** → **Relaunch**

**Petra Wallet:**

Petra works on `localhost` out of the box. For a LAN IP, you may need to use the browser extension directly and approve the connection manually when prompted.

> Recommendation: for LAN testing, access from `http://localhost` on the host machine and use ngrok or Cloudflare Tunnel for remote access over HTTPS.

---

## Operations Guide

### Running in the background (detached mode)

```bash
docker compose up -d
```

This frees up your terminal. All containers run silently in the background.

### Viewing logs

```bash
# All services — live
docker compose logs -f

# Single service only
docker compose logs -f api-gateway
docker compose logs -f stream-node
docker compose logs -f nginx
docker compose logs -f mongodb

# Last 100 lines of a service
docker compose logs --tail=100 api-gateway
```

### Shutting down (data preserved)

```bash
docker compose down
```

MongoDB and Redis volumes are **not** deleted — data persists on the next `up`.

### Shutting down and wiping all data

```bash
docker compose down --volumes
```

### Rebuilding a single service

```bash
docker compose up --build api-gateway
docker compose up --build stream-node
```

### Checking container health

```bash
docker compose ps

# Expected output:
# NAME           STATUS
# api-gateway    Up (healthy)
# stream-node    Up
# mongodb        Up (healthy)
# redis          Up (healthy)
# nats-server    Up
# nginx          Up
```

---

## Environment Variables

### `apps/api-gateway/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express port | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://mongodb:27017/shelbymovie` |
| `NATS_URL` | NATS server URL | `nats://nats-server:4222` |
| `APTOS_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `SESSION_TOKEN_TTL_HOURS` | Session lifetime | `6` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost` |

### `apps/stream-node/.env`

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express port | `4000` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `REDIS_CHUNK_TTL_SECONDS` | Chunk cache TTL | `3600` |
| `SESSION_TTL_SECONDS` | Stream session TTL | `21600` |
| `NATS_URL` | NATS server URL | `nats://nats-server:4222` |
| `SHELBY_API_KEY` | Shelby Protocol API key | — |
| `SHELBY_RPC_URL` | Shelby RPC endpoint | — |

### `apps/frontend/.env.local`

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | API base URL (via nginx) |
| `NEXT_PUBLIC_STREAM_URL` | Stream base URL (via nginx) |
| `NEXT_PUBLIC_APTOS_NETWORK` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_SHELBY_CONTRACT` | Shelby contract address |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Treasury wallet address |

---

## Local Development (without Docker)

```bash
# 1. Install dependencies
pnpm install

# 2. Build shared types (required before running apps)
pnpm --filter @shelby-movie/shared-types build

# 3. Start infrastructure only
docker compose up -d mongodb redis nats-server

# 4. Start services in separate terminals
pnpm --filter api-gateway dev
pnpm --filter stream-node dev
pnpm --filter frontend dev
```

---

## Security Notes

- Private keys must **never** be stored in `.env` files or source code
- All blockchain signing is performed by the user's Petra Wallet
- `blobName` fields are stripped from all API responses — only the stream-node reads them via NATS
- Session tokens are random 32-byte hex strings with configurable TTL
