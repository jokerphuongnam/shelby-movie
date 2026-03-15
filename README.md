# ShelbyMovie

**Decentralized cinematic streaming on the Aptos blockchain.**
Creators publish films on-chain. Viewers pay in APT. No middlemen.

---

## Overview

ShelbyMovie is a full-stack blockchain streaming platform built on the [Shelby Protocol](https://shelby.xyz) and the Aptos blockchain. Creators upload content through a drag-and-drop studio, register blobs on-chain via Petra wallet, and set their own APT price. Viewers pay directly from their wallet and stream instantly — no subscriptions, no platform cuts beyond gas.

The platform ships with two fully isolated Docker environments:

| Mode | Port | Chain | Wallet Required |
| --- | --- | --- | --- |
| **Alpha** (`./run.sh alpha`) | 4546 | Off-chain (simulated) | No |
| **On-chain** (`./run.sh dev`) | 4545 | Aptos Testnet | Petra |

---

## Features

- **Dark cinematic UI** — Netflix-style hero banner, horizontal scroll rows, aspect-ratio poster grid
- **Creator Studio** — drag-and-drop uploads with auto-duration detection, free/paid toggle, series support with per-episode files
- **Blockchain payments** — Petra wallet signs APT transfers; on-chain verification before stream access is granted
- **Preview / Paywall** — configurable free preview window per title; server enforces a 402 at the stream boundary
- **Resume watching** — playback position synced every 30 s, on pause, and on page unload
- **Support Creator** — one-click APT donation directly to the creator's wallet, with confetti confirmation
- **Alpha test mode** — full UI/UX without real transactions; `signMessage` simulates every on-chain action
- **Unlimited upload size** — Nginx `client_max_body_size 0`, 5 MB chunked upload pipeline, no client-side cap

---

## Tech Stack

### Frontend

| | |
| --- | --- |
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS 3 |
| Forms | React Hook Form 7 |
| Icons | Lucide React |
| Wallet | `@aptos-labs/wallet-adapter-react` v3 |
| Chain SDK | `@aptos-labs/ts-sdk` v1 |

### Backend

| Service | Stack |
| --- | --- |
| `api-gateway` | Express · TypeScript · Mongoose (MongoDB 7) · NATS |
| `stream-node` | Express · TypeScript · ioredis · multer · `@shelby-protocol/sdk` |

### Infrastructure

| Component | Image |
| --- | --- |
| MongoDB | `mongo:7` |
| Redis | `redis:7-alpine` |
| NATS JetStream | `nats:2.10-alpine` |
| Reverse Proxy | `nginx:1.25-alpine` |
| Runtime | Docker + Docker Compose v2 |
| Monorepo | pnpm workspaces |

### Blockchain

- **Aptos Testnet** via Shelby RPC (`https://api.shelbynet.shelby.xyz/shelby`)
- **Petra Wallet** — transaction signing and `signMessage` for alpha simulation
- **Shelby Protocol SDK** — blob registration, storage, and retrieval

---

## Architecture

```text
                      ┌──────────────────────────────────────┐
  Browser             │           Docker Network             │
    │                 │                                      │
    ├── :4546 ────────┼──▶  frontend-alpha  (Next.js)        │
    │                 │          │                           │
    ├── :4545 ────────┼──▶  frontend-onchain (Next.js)       │
    │                 │          │                           │
    ├── :80 ──────────┼──▶  nginx  ──▶  frontend-onchain     │
    │                 │      │                               │
    ├── :8080 ────────┼──────┼──▶  api-gateway :3000 ────────┼──▶  MongoDB
    │                 │      │          │                    │
    │                 │      └──▶  stream-node :4000  ───────┼──▶  Redis
    │                 │                 │                    │
    │                 │          nats-server :4222           │
    │                 └──────────────────────────────────────┘
    │
    └── Aptos Testnet (external)
```

### Paid content flow

```text
1.  Viewer  →  POST /api/payment/verify  { txHash, walletAddress }
2.  api-gateway verifies APT transfer on-chain via Aptos SDK
3.  api-gateway issues sessionToken (32-byte hex)
              publishes  video.authorized  to NATS
4.  stream-node stores token in Redis with TTL
5.  Viewer  →  GET /stream/play?token=<sessionToken>
6.  stream-node serves HTTP range requests (206)
```

### Alpha mode flow

```text
1.  Viewer  →  Petra signMessage  (no gas, no hex validation)
2.  Mock sessionToken issued immediately by api-gateway
3.  Direct public video URL played without proxying
```

---

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) ≥ 4.x (Docker Compose v2 included)
- [Petra Wallet](https://petra.app/) browser extension — on-chain mode only
- `.env.alpha` and/or `.env.production` in the project root

---

## Environment Files

Create these files before running. Never commit them.

### `.env.alpha`

```env
NEXT_PUBLIC_SHELBY_CONTRACT=0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a
NEXT_PUBLIC_APT_PRICE_MULTIPLIER=0.5
NEXT_PUBLIC_TREASURY_ADDRESS=0x0
NEXT_PUBLIC_MOCK_VIDEO_URL=https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
```

### `.env.production`

```env
NEXT_PUBLIC_SHELBY_CONTRACT=<deployed_contract_address>
NEXT_PUBLIC_SHELBY_API_KEY=<shelby_api_key>
NEXT_PUBLIC_APT_PRICE_MULTIPLIER=0.5
NEXT_PUBLIC_TREASURY_ADDRESS=<treasury_wallet_address>
```

> **Security:** Private keys must never appear in any env file or source code. All signing is performed by the user's Petra wallet. See `CLAUDE.md` for the full policy.

---

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/shelby-movie.git
cd shelby-movie

# Alpha mode — no wallet or APT needed
./run.sh alpha

# On-chain mode — Aptos Testnet + Petra wallet
./run.sh dev
```

`run.sh` executes five steps automatically:

```text
[1/5]  docker compose down --remove-orphans
[2/5]  docker builder prune -f
[3/5]  docker compose --env-file <env> --profile <mode> up --build -d
[4/5]  Health-poll api-gateway at http://localhost:8080/health (max 2 min)
[5/5]  Alpha only: wipe + re-seed the movies collection
```

### Endpoints after startup

**Alpha (`./run.sh alpha`)**

| Service | URL |
| --- | --- |
| Frontend | <http://localhost:4546> |
| API Gateway | <http://localhost:8080> |

**On-chain (`./run.sh dev`)**

| Service | URL |
| --- | --- |
| Frontend | <http://localhost:4545> |
| Frontend (via Nginx) | <http://localhost> |
| API Gateway | <http://localhost:8080> |

---

## Project Structure

```text
shelby-movie/
├── apps/
│   ├── api-gateway/              # REST API — movies, payments, access, progress
│   │   ├── src/
│   │   │   ├── models/           # Mongoose: Movie, Access, UserPermission, Progress
│   │   │   ├── routes/           # /api/movies  /api/payment  /api/access
│   │   │   └── services/         # movie.service  payment.service
│   │   └── Dockerfile
│   │
│   ├── stream-node/              # Video streaming + chunked upload
│   │   ├── src/
│   │   │   ├── services/         # stream.service — Redis range-request cache
│   │   │   └── shelby/           # shelby.client.ts — Shelby Protocol SDK wrapper
│   │   └── Dockerfile
│   │
│   └── frontend/                 # Next.js 14 App Router
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx              # Home — hero banner + movie rows
│       │   │   ├── watch/[id]/           # Watch page — paywall, resume, player
│       │   │   ├── history/              # My Library — purchases + uploads tabs
│       │   │   └── upload/               # Creator Studio
│       │   ├── components/
│       │   │   ├── movie/                # MovieCard, HeroBanner, VideoPlayer, MovieWatch
│       │   │   ├── upload/               # MovieUploadForm, UploadModal
│       │   │   └── layout/               # NavHeader
│       │   └── lib/
│       │       └── alpha-data.ts         # Mock movies + stable thumbnail pool
│       ├── next.config.mjs
│       └── Dockerfile
│
├── packages/
│   └── shared-types/             # DTOs shared between services
│       └── src/dto/              # MovieDto, HomeDto, ProgressDto, VerifyPaymentDto
│
├── nginx/
│   └── nginx.conf                # Reverse proxy — on-chain mode only
├── docker-compose.yml
└── run.sh
```

---

## API Reference

All routes served from `http://localhost:8080`, prefixed `/api`.

### Movies

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/movies/home?walletAddress=` | Home data — featured, continue watching, sections |
| `GET` | `/api/movies/:id` | Single movie/series metadata |
| `POST` | `/api/movies` | Create movie or series |
| `GET` | `/api/movies/progress?walletAddress&movieId&episodeNumber` | Last resume position |
| `POST` | `/api/movies/progress` | Upsert playback position |

### Access & Payments

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/payment/verify` | Verify on-chain APT transfer → issue session token |
| `POST` | `/api/access/free` | Grant free access → issue session token |
| `GET` | `/api/access/history?walletAddress=` | Purchased content list |

### Streaming & Upload

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/stream/play?token=` | Range-request video stream (Redis-backed) |
| `POST` | `/upload/commitments` | Calculate blob merkle root for on-chain registration |
| `POST` | `/upload/register` | Confirm blob registration after on-chain tx |
| `POST` | `/upload/chunk` | Upload one 5 MB video chunk |

---

## Docker Services

| Container | Profile | Memory | External Port |
| --- | --- | --- | --- |
| `api-gateway` | *(always on)* | 1 GB | `8080` |
| `stream-node` | *(always on)* | 4 GB | — |
| `mongodb` | *(always on)* | — | — |
| `redis` | *(always on)* | — | — |
| `nats-server` | *(always on)* | — | — |
| `frontend-alpha` | `alpha` | — | `4546` |
| `frontend-onchain` | `onchain` | — | `4545` |
| `nginx` | `onchain` | — | `80` |

Profile isolation means `./run.sh alpha` never starts `frontend-onchain` or Nginx, and `./run.sh dev` never starts `frontend-alpha`.

### Useful commands

```bash
# Live logs for a service
docker compose logs -f api-gateway

# Health status of all containers
docker compose ps

# Stop everything (data preserved in volumes)
docker compose down

# Wipe all data including volumes
docker compose down --volumes
```

---

## Environment Variables Reference

### `apps/api-gateway/.env`

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Express listen port | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://mongodb:27017/shelbymovie` |
| `NATS_URL` | NATS server | `nats://nats-server:4222` |
| `SESSION_TOKEN_TTL_HOURS` | Stream session lifetime | `6` |

### `apps/stream-node/.env`

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Express listen port | `4000` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `NATS_URL` | NATS server | `nats://nats-server:4222` |
| `SHELBY_API_KEY` | Shelby Protocol API key | — |
| `SHELBY_RPC_URL` | Shelby RPC endpoint | — |

---

## Key Design Decisions

**No private keys, ever.** All blockchain signing goes through the user's Petra wallet. The backend only receives wallet addresses, signed transactions, and file data. See `CLAUDE.md`.

**Alpha mode is a first-class environment.** Every on-chain action — `register_blob`, APT transfer, donation — has a `signMessage` counterpart in alpha mode. The UI is byte-for-byte identical; no real gas is spent.

**Unoptimized images.** `next.config.mjs` sets `unoptimized: true`, which serves raw CDN URLs (Unsplash, GCS) directly to the browser. This bypasses Next.js server-side image proxying inside Docker, which would otherwise break external thumbnails.

**Unlimited upload size.** Nginx `client_max_body_size 0`, multer configured for 10 GB, and the frontend enforces no client-side cap — designed for full-length cinematic content. File size is governed by application logic, not infrastructure limits.

**Stream-node is stateless per request.** Video chunks are cached in Redis keyed by `blobId + byte range`. Horizontal scaling is possible by adding stream-node replicas to the Nginx upstream pool without any coordination layer.

---

## Local Development (without Docker)

```bash
# Install dependencies
pnpm install

# Build shared types first
pnpm --filter @shelby-movie/shared-types build

# Start infrastructure only
docker compose up -d mongodb redis nats-server

# Start each service in a separate terminal
pnpm --filter api-gateway dev    # :3000
pnpm --filter stream-node dev    # :4000
pnpm --filter frontend dev       # :3001
```

---

## Roadmap

- [ ] Integrate `@shelby-protocol/sdk` — parse `BlobRegistered` Aptos event in `confirmRegistration()`
- [ ] Thumbnail CDN upload (currently uses a stable Unsplash pool in alpha)
- [ ] Mainnet deployment with production APT pricing
- [ ] Creator analytics dashboard
- [ ] Subtitle and chapter marker support
- [ ] Mobile-responsive upload flow

---

## Security

- Private keys must **never** appear in `.env` files, source code, or config
- `blobName` is stripped from all public API responses — only stream-node reads it via NATS
- Session tokens are random 32-byte hex strings stored in Redis with TTL
- Petra wallet owns all signing; the backend never constructs Aptos accounts

---

## License

MIT
