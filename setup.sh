#!/usr/bin/env bash
# setup.sh — One-shot setup for ShelbyMovie on macOS
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────────────────
NUKE=false
REBUILD=false
for arg in "$@"; do
  case "$arg" in
    --nuke)    NUKE=true ;;
    --rebuild) REBUILD=true ;;
  esac
done

echo ""
echo "══════════════════════════════════════════════"
echo "  ShelbyMovie — Docker Setup (macOS)"
echo "══════════════════════════════════════════════"
echo ""

# ── Nuke mode: wipe all containers, images, and volumes ───────────────────────
if [ "$NUKE" = true ]; then
  warn "NUKE mode — stopping and removing all ShelbyMovie containers, images, and volumes..."
  docker compose down --remove-orphans --volumes 2>/dev/null || true
  docker rmi $(docker images --filter=reference="shelby-movie*" -q) 2>/dev/null || true
  info "All containers and volumes removed."
  echo ""
  echo "  Rebuild now with:"
  echo ""
  echo "    CACHE_BUST=\$(date +%s) docker compose up --build -d"
  echo ""
  exit 0
fi

# ── 1. Check Docker Desktop is running ────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  warn "Docker daemon not responding. Attempting socket fix..."

  # On macOS, Docker Desktop writes to a user-level socket, not /var/run/docker.sock
  USER_SOCK="$HOME/.docker/run/docker.sock"

  if [ -S "$USER_SOCK" ]; then
    echo "  Found socket at: $USER_SOCK"
    echo "  Symlinking to /var/run/docker.sock (requires sudo)..."
    sudo ln -sf "$USER_SOCK" /var/run/docker.sock
    sleep 2

    if docker info > /dev/null 2>&1; then
      info "Docker daemon connected via socket symlink."
    else
      error "Still cannot connect after symlink.
  → Open Docker Desktop from Applications.
  → Wait for the whale icon in the menu bar to stop animating.
  → Then go to: Docker Desktop → Settings → Advanced
      → Enable: \"Allow the default Docker socket to be used (requires password)\"
  → Re-run: ./setup.sh"
    fi
  else
    error "Docker socket not found at $USER_SOCK.
  → Docker Desktop is not running.
  → Open Docker Desktop, wait for it to fully start, then re-run: ./setup.sh"
  fi
else
  info "Docker daemon is running."
fi

# ── 2. Verify Docker Compose V2 ───────────────────────────────────────────────
if ! docker compose version > /dev/null 2>&1; then
  error "Docker Compose V2 not found. Update Docker Desktop to v4.x or later."
fi
info "Docker Compose V2 available."

# ── 3. Create .env files if missing ───────────────────────────────────────────
echo ""
echo "Checking environment files..."

if [ ! -f "apps/api-gateway/.env" ]; then
  warn "apps/api-gateway/.env missing — creating with defaults."
  cat > "apps/api-gateway/.env" <<'EOF'
PORT=3000
MONGO_URI=mongodb://mongodb:27017/shelbymovie
NATS_URL=nats://nats-server:4222
APTOS_NETWORK=testnet
SESSION_TOKEN_TTL_HOURS=6
CORS_ORIGIN=http://localhost
EOF
  info "Created apps/api-gateway/.env"
else
  info "apps/api-gateway/.env exists."
fi

if [ ! -f "apps/stream-node/.env" ]; then
  warn "apps/stream-node/.env missing — creating with defaults."
  cat > "apps/stream-node/.env" <<'EOF'
PORT=4000
REDIS_URL=redis://redis:6379
REDIS_CHUNK_TTL_SECONDS=3600
SESSION_TTL_SECONDS=21600
NATS_URL=nats://nats-server:4222
SHELBY_NETWORK=shelbynet
SHELBY_API_KEY=your_shelby_api_key_here
CORS_ORIGIN=http://localhost
EOF
  info "Created apps/stream-node/.env"
else
  info "apps/stream-node/.env exists."
fi

# ── 4. Verify all required source files are present ───────────────────────────
echo ""
echo "Checking project structure..."

required_files=(
  "package.json"
  "pnpm-workspace.yaml"
  "nginx/nginx.conf"
  "packages/shared-types/src/index.ts"
  "packages/shared-types/package.json"
  "packages/shared-types/tsconfig.json"
  "apps/api-gateway/src/index.ts"
  "apps/api-gateway/package.json"
  "apps/api-gateway/tsconfig.json"
  "apps/api-gateway/Dockerfile"
  "apps/stream-node/src/index.ts"
  "apps/stream-node/package.json"
  "apps/stream-node/tsconfig.json"
  "apps/stream-node/Dockerfile"
)

missing=0
for f in "${required_files[@]}"; do
  if [ ! -f "$f" ]; then
    warn "Missing: $f"
    missing=$((missing + 1))
  else
    info "Found:   $f"
  fi
done

if [ $missing -gt 0 ]; then
  error "$missing required file(s) are missing. Restore from git before building."
fi

# ── 5. All clear ──────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  All checks passed."
echo ""

if [ "$REBUILD" = true ]; then
  echo "  --rebuild flag detected. Forcing fresh frontend build..."
  echo ""
  CACHE_BUST=$(date +%s) docker compose up --build -d
  echo ""
  echo "  Frontend rebuilt. Visit: http://localhost:4545"
else
  echo "  Normal start:"
  echo ""
  echo "    docker compose up --build -d"
  echo ""
  echo "  Force fresh Next.js rebuild (if UI looks stale):"
  echo ""
  echo "    CACHE_BUST=\$(date +%s) docker compose up --build -d"
  echo ""
  echo "  Full nuke (removes all containers + volumes):"
  echo ""
  echo "    ./setup.sh --nuke && CACHE_BUST=\$(date +%s) docker compose up --build -d"
  echo ""
  echo "  After startup:"
  echo ""
  echo "    curl http://localhost/health          # → {\"status\":\"ok\"}"
  echo "    open http://localhost:4545            # ShelbyMovie dashboard"
  echo "    docker compose ps                    # all services 'running'"
  echo "══════════════════════════════════════════════"
fi
echo ""
