# Tela "Assinatura" — Tasks

**Spec**: `spec.md` · **Status**: Draft (⏳ todas)
Gates (`.specs/codebase/TESTING.md`): `quick` = `pnpm test` no app tocado; `full` = typecheck + test nos dois.
Nunca `prisma migrate deploy`/`start:migrate` local (`api/.env` = produção); migration com `migrate dev --create-only`
em Postgres descartável (memória: teste local). Contrato HTTP fixo em `spec.md` §Contrato: app e api andam em paralelo.

## Plano de execução

```
F1 [P]: T1 T3 T4 T6 T10 T11 T12        (sem dependência entre si)
F2 [P]: T2 (T1) · T5 (T4) · T13 (T10,T11,T12) · T14 (T10,T12)
F3:     T7 (T1,T4,T5,T6) → T8 (T3,T7)
F4:     T15 (T13,T14) → T16 (T15)
F5:     T17 (T2,T8,T16) → T18 (T17)
```

## API

### T1 [P]: Campo de vencimento ✅ 0bbc3f0
**What**: `Tenant.subscriptionExpiresAt DateTime?` + migration `add_tenant_subscription_expires_at`; entidade e mapper.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_tenant_subscription_expires_at/`, `tenants/domain/entities/Tenant.ts`, `tenants/infrastructure/mappers/PrismaTenantMapper.ts`.
**Depends on**: — (D1) **Req**: SUB-03 **Done when**: migration aplica no descartável; `tsc` verde. **Tests**: none **Gate**: full

### T2: Receiver grava `expiresAt` ✅ 548e196
**What**: `BillingEventPayload.expiresAt?: string|null`; parse ISO em `billing.routes.ts:90-93` (inválido → `null`); `ApplyBillingEventUseCase` grava em `activated`/`renewed`/`updated`, mantém nos demais.
**Where**: `integrations/billing/ApplyBillingEventUseCase.ts`, `billing.routes.ts` (+ `ApplyBillingEventUseCase.test.ts`, `billing.routes.test.ts`).
**Depends on**: T1 **Req**: SUB-03 **Done when**: testes: renewed com data grava; payment_failed preserva; data inválida vira null. **Tests**: unit **Gate**: quick

### T3 [P]: Hook tolerante a tenant inativo ✅ 5d3950a
**What**: `resolveMembership(..., { allowInactive?: boolean })`; hook `tenantAnyStatusHook` (mesmo header `x-tenant-id`) que só pula a checagem de status. Membro inexistente segue 403.
**Where**: `shared/http/hooks/resolveMembership.ts`, `shared/http/hooks/tenantAnyStatusHook.ts` (+ teste).
**Depends on**: — **Req**: SUB-02 **Done when**: teste: SUSPENDED passa no hook novo e falha no `tenantHook`; não-membro 403 nos dois. **Tests**: unit **Gate**: quick

### T4 [P]: Regra pura dos limites exibidos ✅ 33ec2ee
**What**: `SUBSCRIPTION_LIMIT_ITEMS` (chave, canal, kind) a partir de `ENTITLEMENT_KEYS`/`limitKeyOfChannel`; `buildSubscriptionLimits(values, usage)` → itens do contrato (ausente numérico = ilimitado; feature ausente = `false`, exceto `mention_all_enabled`/`ai_rewrite_enabled`, só `false` explícito bloqueia).
**Where**: `tenants/domain/services/subscriptionLimits.ts` (+ `.test.ts`).
**Depends on**: — **Req**: SUB-04 **Done when**: teste trava a lista contra `ENTITLEMENT_KEYS` (chave nova sem decisão falha) e as regras de ausente. **Tests**: unit **Gate**: quick

### T5: Leitor de uso ✅ df1c2c2
**What**: porta `ITenantUsageReader.read(tenantId)` → contagens do §SUB-05; impl Prisma com `tenantId` em toda consulta: sessões por `engine`, `MonitoredGroup`/`BroadcastGroup` de sessões existentes por canal, `LinkRotation` por canal, `Offer` desde `startOfDayInZone(now)`, `AiUsageLog` do dia.
**Where**: `tenants/domain/contracts/ITenantUsageReader.ts`, `tenants/infrastructure/repositories/PrismaTenantUsageReader.ts`.
**Depends on**: T4 (tipo de uso) **Req**: SUB-05 **Done when**: `tsc`; conferido no descartável que bate com as telas de sessões, monitoramento, rodízio e gerador. **Tests**: none (infra Prisma) **Gate**: full

### T6 [P]: Leitura de entitlements em lote ✅ 567372f
**What**: porta nova `IEntitlementSnapshotReader.readAll(tenantId): Record<string, unknown>` (não muda `IEntitlementReader`, evita quebrar fakes) e impl em `PrismaEntitlementReader` (1 `findMany`).
**Where**: `tenants/domain/contracts/IEntitlementSnapshotReader.ts`, `tenants/infrastructure/repositories/PrismaEntitlementReader.ts`.
**Depends on**: — **Req**: SUB-04 **Tests**: none **Gate**: quick

### T7: `GetTenantSubscriptionUseCase` ✅ c7a0a09
**What**: tenant (repo) + snapshot + uso em paralelo → `GetTenantSubscriptionOutput` (DTO); tenant inexistente → `NotFoundError` (404).
**Where**: `tenants/application/use-cases/GetTenantSubscriptionUseCase.ts`, `tenants/application/dtos/TenantSubscriptionDto.ts` (+ teste com fakes).
**Depends on**: T1, T4, T5, T6 **Req**: SUB-01, 04 **Done when**: teste: plano nulo, SUSPENDED com `suspendedAt`, ilimitado, Telegram 0. **Tests**: unit **Gate**: quick

### T8: Rota + presenter ✅ 91cb93a
**What**: `GET /subscription` com `[authHook, tenantAnyStatusHook]`, schema de resposta (OpenAPI), `SubscriptionPresenter` (datas ISO, slug fora de `PLAN_SLUGS` → `null`); registro em `routes.ts`.
**Where**: `tenants/presentation/routes/subscription.routes.ts`, `tenants/presentation/presenters/SubscriptionPresenter.ts`, `api/src/app/routes.ts` (+ `subscription.routes.test.ts` com inject).
**Depends on**: T3, T7 **Req**: SUB-01, 02 **Done when**: inject: 200 no ACTIVE e no SUSPENDED; 401 sem token; 403 não-membro. **Tests**: unit **Gate**: full

## App

### T10 [P]: Tipos + serviço ✅ 702015b
**What**: `SubscriptionResponse` (contrato da spec) e `subscription.service.ts` (`getSubscription()` pelo `apiClient`).
**Where**: `app/src/types/api.types.ts`, `app/src/services/subscription.service.ts` (+ `.test.ts`).
**Depends on**: — (contrato fixo) **Req**: SUB-01 **Tests**: unit **Gate**: quick

### T11 [P]: Link da página de venda ✅ 1666d18
**What**: `buildCheckoutUrl(slug, period, search)` do `plans-modal` T3: `VITE_BILLING_CHECKOUT_URL` + `/planos/copysync-{plano}-{periodo}`, repassa `utm_*`/`gclid`/`fbclid`, env ausente → `null`; documentar em `app/.env.example`.
**Where**: `app/src/features/plans/checkout.ts` (+ `.test.ts`), `app/.env.example`.
**Depends on**: — (D2) **Req**: SUB-07 **Tests**: unit **Gate**: quick

### T12 [P]: Textos e privacidade ✅ 3bc9c14
**What**: `features/subscription/strings.ts` (título, status, vencimento, rótulos/hints por chave, CTA, aviso de suspensão, "Ilimitado", "Incluso", "A partir do X" via `PLAN_CATALOG`); tela `subscription` em `PRIVACY_SCREENS` com flag `subscription.tenantName`.
**Where**: `app/src/features/subscription/strings.ts`, `app/src/features/privacy/privacyFlags.ts` (+ `privacy.test.tsx` se contar telas).
**Depends on**: — **Req**: SUB-10 **Tests**: unit **Gate**: quick

### T13: Card do plano ✅ 452ef39
**What**: `SubscriptionPlanCard`: nome/tagline do catálogo pelo slug (sem preço), chip de status, vencimento (`Intl.DateTimeFormat`), nome do tenant com `Blurred`, CTA (`AppIcon` `Crown`/`ExternalLink`) em nova aba ou `/affiliates/plans` quando `null`; aviso `warning` em SUSPENDED/CANCELLED.
**Where**: `app/src/features/subscription/components/SubscriptionPlanCard.tsx` (+ teste).
**Depends on**: T10, T11, T12 **Req**: SUB-06, 07, 09 **Done when**: teste nos 3 status + sem plano, claro e escuro, CTA com/sem env. **Tests**: unit **Gate**: quick

### T14: Tabela de limites ✅ e9489d3
**What**: `SubscriptionLimitsTable`: `<table>` semântica por canal (logos via `AppIcon`), `LinearProgress` com cor da regra do `OfferUsageChip` (extrair `usageTone(used, limit)` para `features/subscription/usageTone.ts`), Tooltip com hint, linha `daily` com "hoje", feature como Incluso/A partir do X.
**Where**: `app/src/features/subscription/components/SubscriptionLimitsTable.tsx`, `app/src/features/subscription/usageTone.ts` (+ testes).
**Depends on**: T10, T12 **Req**: SUB-08 **Done when**: teste: ilimitado sem barra, 100% `error`, ≥80% `warning`, Telegram 0 = "A partir do PRO". **Tests**: unit **Gate**: quick

### T15: Página, rota e menu ✅ 6ddf4e1
**What**: `SubscriptionPage` (carrega pelo serviço, skeleton, erro com retry; aba de canal em `usePersistedState` escopo `tab`); rota `/settings/subscription`; item no `SettingsLayout` (D3).
**Where**: `app/src/pages/settings/SubscriptionPage.tsx`, `app/src/routes/AppRoutes.tsx`, `app/src/features/settings/components/SettingsLayout.tsx` (+ teste da página).
**Depends on**: T13, T14 **Req**: SUB-10 **Tests**: unit **Gate**: quick

### T16: Redirect em tenant suspenso ✅ 88e5523
**What**: no interceptor, `code === 'TENANT_SUSPENDED'` → `/settings/subscription?suspended=1` (uma vez, nunca na própria rota; sem `clearSession`).
**Where**: `app/src/services/apiClient.ts` (+ teste).
**Depends on**: T15 **Req**: SUB-09 **Done when**: teste: redireciona de outra rota; não faz loop na tela. **Tests**: unit **Gate**: full

## Fechamento

### T17: Docs, CHANGELOG e versão ⏳
**What**: `docs/assinatura.md` (o que é, contrato, hook tolerante, o que não fazer: preço, checkout próprio, chamada à central); linha no `AGENTS.md`; linha "Painel" de `docs/arquitetura-central-billing.md` aponta para lá; CHANGELOG; api 0.60.0 e app 0.77.0 (minor).
**Where**: `docs/assinatura.md`, `AGENTS.md`, `docs/arquitetura-central-billing.md`, `CHANGELOG.md`, `api/package.json`, `app/package.json`.
**Depends on**: T2, T8, T16 **Req**: SUB-11 **Tests**: none **Gate**: full

### T18: Verificação visual ✅
**What**: agent-browser contra API local com Postgres descartável: claro/escuro/sistema, 375 px e 1280 px, ACTIVE/SUSPENDED/sem plano, privacidade ligada.
**Where**: — (screenshots no PR) **Depends on**: T17 **Req**: SUB-06..10 **Tests**: e2e manual **Gate**: full

## Decisões para o dono

| # | Decisão | Recomendação |
| --- | --- | --- |
| D1 | Guardar vencimento (`Tenant.subscriptionExpiresAt`, migration) ou não mostrar | Guardar: o hub já manda `expiresAt`; sem ele não há "vence em" |
| D2 | Link: redirect da central (`VITE_BILLING_CHECKOUT_URL` + slug `copysync-*`, já decidido no `plans-modal`) ou link Cakto por plano no `catalog.ts` | Redirect da central: trocar oferta não vira deploy; Cakto direto no código foi vetado (alternativa D) |
| D3 | Onde fica: Configurações > Assinatura ou filho de Afiliados | Configurações: plano é do tenant (1 `planSlug`), como sessão (`navegacao-produtos.md`) |
| D4 | Quem vê: todos os papéis ou só ADMIN | Todos veem; CTA só para ADMIN (OPERATOR vê "fale com o administrador") |
| D5 | Uso de grupos: contagem gravada ou "ao vivo" (participação atual via engine, como o monitoramento) | Gravada: tela leve e sem engine; diferença documentada |
| D6 | Tela acessível com tenant suspenso (hook tolerante, só esta rota) | Sim, senão o cliente que precisa pagar não vê o motivo |

## Riscos

- Hook tolerante usado em outra rota abre dado de tenant suspenso: teste trava o uso só em `subscription.routes.ts`; doc diz "não reusar".
- `expiresAt` só aparece após o próximo evento do hub (tenants atuais ficam `null` até renovar ou até a reconciliação H2).
- Contagem divergente das telas de recurso (grupos de sessão apagada, grupo que saiu): conferir em T5; D5.
- `VITE_BILLING_CHECKOUT_URL` e as 6 linhas `RedirectConfig` na central são operação (`plans-modal` T10): sem elas o CTA cai na vitrine `/affiliates/plans`.
- Chave de entitlement nova sem linha na tela: teste de T4 falha de propósito.
- Redirect de suspenso em loop ou derrubando sessão: teste de T16; nunca `clearSessionAndRedirect` nesse código.

## Notas de execução

- T7: `GetTenantSubscriptionUseCase` lê vencimento via alias `TenantWithExpiry` (opcional) e devolve `expiresAt: null` até a T1; remover o alias quando a T1 entrar.
- D1 (guardar vencimento) seguido pela recomendação em 2026-11-04 para destravar T1/T2 e o follow-up do receiver (`expiresAt` de `subscription.updated`); dono pode rever.
- T1: `Tenant.subscriptionExpiresAt` (migration `20261105001005`); alias da T7 removido.
- T8: `GET /subscription` com `tenantAnyStatusHook`; presenter traduz `COPYSYNC_LITE/PRO/MAX` → `starter/profissional/business` (registrar em docs na T17).
- T18: agent-browser contra Postgres descartável (ACTIVE/PRO, SUSPENDED/LITE com `?suspended=1`, sem plano, OPERATOR), claro/escuro, 1280 e 390 px, borrar ligado, tooltips. Corrigidos tom de `0 de 1` e colunas da tabela (app 0.76.2). Fora do escopo: o painel não tem modo "sistema" (`ThemeContext` só claro/escuro; sem preferência salva abre claro mesmo com `prefers-color-scheme: dark`); nome do tenant no cabeçalho global não borra.
