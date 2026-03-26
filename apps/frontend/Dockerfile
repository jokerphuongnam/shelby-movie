FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --frozen-lockfile

COPY packages/shared-types ./packages/shared-types
COPY apps/frontend ./apps/frontend

# Increment to bust the Next.js build cache without rebuilding the full image:
#   CACHE_BUST=$(date +%s) docker-compose up --build frontend
ARG CACHE_BUST=1

# NEXT_PUBLIC_* vars must be present at build time — Next.js embeds them in the bundle
ARG NEXT_PUBLIC_API_URL=http://localhost
ARG NEXT_PUBLIC_STREAM_URL=http://localhost
ARG NEXT_PUBLIC_APTOS_NETWORK=testnet
ARG NEXT_PUBLIC_APTOS_NODE_URL=https://api.shelbynet.shelby.xyz/shelby
ARG NEXT_PUBLIC_SHELBY_CONTRACT=0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a
ARG NEXT_PUBLIC_SHELBY_API_KEY=
ARG NEXT_PUBLIC_TREASURY_ADDRESS=0x0
ARG NEXT_PUBLIC_APT_PRICE_MULTIPLIER=0.5
ARG NEXT_PUBLIC_ALPHA_TEST=false
ARG NEXT_PUBLIC_MOCK_VIDEO_URL=

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STREAM_URL=$NEXT_PUBLIC_STREAM_URL
ENV NEXT_PUBLIC_APTOS_NETWORK=$NEXT_PUBLIC_APTOS_NETWORK
ENV NEXT_PUBLIC_APTOS_NODE_URL=$NEXT_PUBLIC_APTOS_NODE_URL
ENV NEXT_PUBLIC_SHELBY_CONTRACT=$NEXT_PUBLIC_SHELBY_CONTRACT
ENV NEXT_PUBLIC_SHELBY_API_KEY=$NEXT_PUBLIC_SHELBY_API_KEY
ENV NEXT_PUBLIC_TREASURY_ADDRESS=$NEXT_PUBLIC_TREASURY_ADDRESS
ENV NEXT_PUBLIC_APT_PRICE_MULTIPLIER=$NEXT_PUBLIC_APT_PRICE_MULTIPLIER
ENV NEXT_PUBLIC_ALPHA_TEST=$NEXT_PUBLIC_ALPHA_TEST
ENV NEXT_PUBLIC_MOCK_VIDEO_URL=$NEXT_PUBLIC_MOCK_VIDEO_URL

RUN pnpm --filter frontend build

FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

WORKDIR /app/apps/frontend
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
