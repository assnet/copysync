FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache openssl \
  && corepack enable \
  && corepack prepare pnpm@10.33.0 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN pnpm prisma generate \
  && pnpm build

FROM base AS runner

ENV NODE_ENV=production \
    PORT=3333 \
    HOST=0.0.0.0

COPY package.json pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

EXPOSE 3333

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/app/server.js"]