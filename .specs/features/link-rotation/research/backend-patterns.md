# Pesquisa — padrões backend (2026-10-28, read-only)

## Módulo + rotas
- Estrutura: `api/src/modules/automation/{domain,application,infrastructure,presentation}`; container lazy em `infrastructure/automationContainer.ts:1-40` (`lazy(make)`, repos `PrismaXRepository(prisma)`, entitlements via `offersContainer.entitlements()`).
- Rotas: `presentation/routes/groupMonitoring.routes.ts:1-16` — `preHandler=[authHook, tenantHook]`; registro em `api/src/app/routes.ts` (~L68) com prefixo `${env.API_PREFIX}/automation/group-monitoring`; campaigns em `/campaigns/offers`, `/campaigns/send-queue`.
- Handler: `app.get<{Querystring}>(path, {preHandler, schema:{tags,summary,querystring,response}}, async (req, reply) => …)`; tenant em `request.tenantContext.tenantId`; resposta `httpResponse.ok/created`.

## Entitlement + erro
- `GroupMonitorConfigUseCases.ts:16-23` deps `{…, entitlements: IEntitlementReader, now?: () => Date}`; base abstrata `constructor(protected readonly deps)`.
- `:157-158` `getNumber(tenantId, key)`; `limit !== null && atual + novos > limit` → `throw new PlanLimitReachedError(key, limit)` (`shared/errors/internal/PlanErrors.ts:4`, 403, details `{key,limit}`); `PlanFeatureUnavailableError(key)` `:11`.
- `IEntitlementReader` `tenants/domain/contracts/IEntitlementReader.ts:2-7`; impl `PrismaEntitlementReader.ts:23`. Chaves `tenants/domain/entitlementKeys.ts`.

## Super-admin
- `assistants/presentation/routes/ai.routes.ts:43-44` `aiAdminRoutes` `preHandler=[authHook, superAdminHook]`; `uc = () => assistantsContainer.useCases()`; presenter `presenters/AiPresenter.ts`. Registro `routes.ts` ~L77 prefixo `/admin/ai`.
- `shared/http/hooks/superAdminHook.ts:3-8`.
- App: `pages/admin/AdminAiPage.tsx`, `routes/AppRoutes.tsx:15,58`, `features/ai/components/SuperAdminRoute.tsx:5-7`, `services/adminAi.service.ts` (`BASE='/admin/ai'`).

## Rate limit
- Global `app.ts:106-109` `@fastify/rate-limit` 120/min por `request.ip`. Presets `shared/http/rateLimitPresets.ts:3-19` (`lifecycle` 30, `extensionAuth` 10, `extensionSync` 60, `general` 120). Por rota: `config: { rateLimit: rateLimitPresets.X }` (ex. `extension.routes.ts:72`).

## Jobs / lease
- `server.ts:154-160` sweep com `setInterval(...).unref()` atrás de `MEDIA_PENDING_RECOVERY_ENABLED`; `:167-188` worker atrás de `OFFER_DISPATCH_WORKER_ENABLED || GROUP_MONITORING_ENABLED`, `safe(name, run)`.
- `campaigns/infrastructure/worker/OfferDispatchWorker.ts:13-49` padrão de worker (interval, `runTick`, stop com timeout 10s). Mesmo padrão: `ExtensionRetentionJob.ts:31`, `HubOutboxWorker.ts:32`, `UploadSessionSweeper.ts:67`.
- Flags env: `env.ts:99,105,112` `z.string().transform(v => v==='true').default('false')`.
- `JobLease` `schema.prisma:925-931`; único uso `ReconcileSubscriptionsUseCase.ts:55-73` (`acquireLease` updateMany expirado → create; `releaseLease`).

## Grupos
- Model é `ChatConversation` (`schema.prisma:417-470`): `tenantId, sessionId?, isGroup, groupJid? (sem @g.us), groupName?, groupAvatarUrl?`.
- Picker: `app/src/features/offers/hooks/useSessionGroups.ts` → `GET /campaigns/offers/config/groups` (`offer.routes.ts:115`). `GroupPickerDialog.tsx:113 useSessionGroups(sessionIds, search)`.
- `GET /conversations?sessionId&isGroup` `chat.routes.ts:102,117-118`.

## Hash / clock
- `createHash('sha256')` em `shared/utils/generateInviteToken.ts`, `extension/domain/services/tokenHash.ts:4`. Sem util de salt em shared. Sem `IClock`: `now?: () => Date` injetado.

## Migrations / seed
- Última: `20261029000100_add_affiliate_credential_rejection`. Padrão `YYYYMMDDHHMMSS_snake_descricao` + comentário PT no topo.
- Seed presets `seed.ts:114-125` via `planPresetRows()`; entitlements `:103-111`.

## /me e limits
- `me.routes.ts:19` sem `planSlug`/`limits`. Limites chegam ao front no payload do recurso (`groupMonitoring.schema.ts:97 limits{…}`; `monitoring.service.ts:16`). Seguir igual: `limits` no `GET /campaigns/link-rotation`.
