FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api-gateway/package.json ./apps/api-gateway/

RUN pnpm install --frozen-lockfile

COPY packages/shared-types ./packages/shared-types
RUN pnpm --filter @shelby-movie/shared-types build

COPY apps/api-gateway ./apps/api-gateway
RUN pnpm --filter api-gateway build
RUN cd apps/api-gateway && npx tsc -p tsconfig.scripts.json

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api-gateway/package.json ./apps/api-gateway/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/apps/api-gateway/dist ./apps/api-gateway/dist
COPY --from=builder /app/apps/api-gateway/dist-scripts ./apps/api-gateway/dist-scripts

WORKDIR /app/apps/api-gateway
CMD ["node", "dist/index.js"]
