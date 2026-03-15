#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run.sh — ShelbyMovie deployment helper
#
# Usage:
#   ./run.sh dev     — on-chain mode  (port 4545, Petra wallet required)
#   ./run.sh alpha   — off-chain mode (port 4546, no wallet or APT needed)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${1:-}"

usage() {
  echo ""
  echo "  Usage: $0 [dev|alpha]"
  echo ""
  echo "    dev   — on-chain (Aptos + Shelby) frontend on port 4545"
  echo "    alpha — off-chain test mode, mock data, no wallet needed, port 4546"
  echo ""
}

if [[ -z "$MODE" || "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$MODE" != "dev" && "$MODE" != "alpha" ]]; then
  echo "  Error: unknown mode '$MODE'"
  usage
  exit 1
fi

# ── Resolve env file ──────────────────────────────────────────────────────────
if [[ "$MODE" == "alpha" ]]; then
  ENV_FILE=".env.alpha"
  COMPOSE_PROFILES="--profile alpha"
  export ALPHA_SEED="true"
else
  ENV_FILE=".env.production"
  COMPOSE_PROFILES="--profile onchain"
  export ALPHA_SEED="false"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "  Error: $ENV_FILE not found."
  exit 1
fi

# ── Force fresh Next.js build on every run ────────────────────────────────────
export CACHE_BUST="$(date +%s)"

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  ShelbyMovie — mode: $MODE$([ "$MODE" = "dev" ] && echo "     " || echo "   ")           │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── Step 1: Tear down existing containers ─────────────────────────────────────
echo "  [1/5] Stopping containers..."
docker compose down --remove-orphans
echo ""

# ── Step 2: Prune build cache ─────────────────────────────────────────────────
#   WARNING: removes all cached build layers — next build will be slower.
echo "  [2/5] Pruning Docker build cache..."
docker builder prune -f
echo ""

# ── Step 3: Build and start ───────────────────────────────────────────────────
echo "  [3/5] Building and starting ($ENV_FILE)..."
echo ""

# shellcheck disable=SC2086
docker compose \
  --env-file "$ENV_FILE" \
  $COMPOSE_PROFILES \
  up --build -d

echo ""

# ── Step 4: Wait for api-gateway health ──────────────────────────────────────
echo "  [4/5] Waiting for api-gateway to be ready..."
ATTEMPTS=0
MAX_ATTEMPTS=40
until curl -sf http://localhost:8080/health > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; then
    echo ""
    echo "  ✗ api-gateway did not become healthy in time."
    echo "    Check logs: docker compose logs api-gateway"
    exit 1
  fi
  printf "."
  sleep 3
done
echo ""

# ── Step 5: Alpha — wipe movies collection and re-seed ───────────────────────
if [[ "$MODE" == "alpha" ]]; then
  echo "  [5/5] Wiping movies collection and re-seeding fresh data..."
  docker compose exec -T mongodb mongosh --quiet \
    --eval "db.getSiblingDB('shelbymovie').movies.deleteMany({})" > /dev/null
  curl -sf -X POST http://localhost:8080/api/admin/seed > /dev/null
  echo "  ✓ Movies collection refreshed."
  echo ""
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ ShelbyMovie is up and running!"
echo ""

if [[ "$MODE" == "alpha" ]]; then
  echo "  ┌──────────────────────────────────────────────────┐"
  echo "  │  ALPHA mode (off-chain)                          │"
  echo "  │                                                  │"
  echo "  │  Frontend  →  http://localhost:4546              │"
  echo "  │  API       →  http://localhost:8080              │"
  echo "  │                                                  │"
  echo "  │  No Petra wallet required.                       │"
  echo "  │  Mock movies are pre-seeded in MongoDB.          │"
  echo "  └──────────────────────────────────────────────────┘"
else
  echo "  ┌──────────────────────────────────────────────────┐"
  echo "  │  DEV mode (on-chain)                             │"
  echo "  │                                                  │"
  echo "  │  Frontend  →  http://localhost:4545              │"
  echo "  │  Nginx     →  http://localhost                   │"
  echo "  │  API       →  http://localhost:8080              │"
  echo "  │                                                  │"
  echo "  │  Petra wallet required for uploads and payments. │"
  echo "  └──────────────────────────────────────────────────┘"
fi

echo ""
