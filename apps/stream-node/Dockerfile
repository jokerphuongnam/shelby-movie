FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/stream-node/package.json ./apps/stream-node/

RUN pnpm install --frozen-lockfile

COPY packages/shared-types ./packages/shared-types
RUN pnpm --filter @shelby-movie/shared-types build

COPY apps/stream-node ./apps/stream-node
RUN pnpm --filter stream-node build

FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/stream-node/package.json ./apps/stream-node/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/apps/stream-node/dist ./apps/stream-node/dist

WORKDIR /app/apps/stream-node
CMD ["node", "dist/index.js"]
