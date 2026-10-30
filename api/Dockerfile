FROM node:22-alpine AS base

WORKDIR /app

# ffmpeg (traz ffprobe) só para o docker-compose local; produção usa o do runtime nativo da Render.
RUN apk add --no-cache openssl ffmpeg \
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
COPY scripts ./scripts
# Fontes e assets do renderer do story de oferta (lidos por __dirname em offerStoryFonts.ts).
COPY assets ./assets

EXPOSE 3333

# Migrations antes do servidor: `prisma migrate deploy` é idempotente e usa advisory lock no
# Postgres, então é seguro em todo boot. Se falhar, o container não sobe e a Render mantém a
# versão anterior no ar (deploy fica vermelho em vez de API quebrada com schema velho).
CMD ["pnpm", "start:migrate"]