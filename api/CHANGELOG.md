# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [0.84.0 · app 0.103.0] — 2026-11-11 — Escala dos workers por decisão do super admin

Subir ou reduzir réplicas do worker exigia o painel da Render, sem regra de capacidade nem rastro. O super admin passa a
pedir a escala em `/admin/workers/scale`, com as regras de WSCALE-12, evento antes da chamada e auditoria. Spec:
`.specs/features/worker-scaling/` (WSCALE-09, 11..14, 19; fase P3). Doc: `docs/workers-escala.md` (Escala).
**Migration Prisma**: sim (`20261111150000_create_worker_scale_events`). **Breaking**: não. **Kill switch**:
`WORKER_SCALER_ENABLED=false` por default (D8/D10): sem ela nada chama a Render; ligar só após o T25 (smoke real, dono).

### Added

#### API — `prisma`

- **`prisma/migrations/20261111150000_create_worker_scale_events/migration.sql`**, **`schema.prisma`** — tabela `worker_scale_events` (`trigger`, `actorUserId` nulo = sistema, réplicas de/para, motivo, `outcome`, `error` curto, `requestId` único).

#### API — `sessions`

- **`domain/contracts/IWorkerScaleEventRepository.ts`**, **`infrastructure/repositories/PrismaWorkerScaleEventRepository.ts`** — gravar, atualizar resultado, último sucesso, busca por `requestId`, lista por cursor opaco, limpeza de 180 dias em lotes (job da P4).
- **`domain/contracts/IWorkerScaler.ts`**, **`infrastructure/scaler/RenderWorkerScaler.ts`**, **`NotConfiguredWorkerScaler.ts`**, **`workerScaler.ts`** — porta e adaptador Render (`GET /services/{id}`, `/instances`, `POST /scale`; timeout 5 s; 429 com `Retry-After`; recusa com disco ou autoescala nativa); sem as três envs o estado é `not_configured` com `missing` (só nomes).
- **`shared/config/env.ts`** — `WORKER_SCALER_ENABLED` (default `false`) e `WORKER_SCALER_SERVICE_ID` (`^srv-[a-z0-9]+$`; inválido = ausente, 1 `warn` sem o valor, boot segue). Valem no `http` e no `worker`.
- **`shared/errors/internal/WorkerScalingErrors.ts`** — `SCALER_NOT_CONFIGURED`, `SCALER_UNAVAILABLE` (503), `SCALER_RATE_LIMITED` (429), `SCALER_SERVICE_NOT_SCALABLE`, `SCALER_MODE_OFF`, `ADOPTION_DISABLED`, `SCALE_TARGET_OUT_OF_RANGE` (400), `SCALE_TARGET_UNCHANGED`, `SCALE_COOLDOWN_ACTIVE`, `SCALE_DOWN_WOULD_EXCEED_CAPACITY` (409 nos demais).
- **`application/use-cases/ScaleWorkersUseCase.ts`** — regras na ordem: modo `off`, adoção, faixa, estado ao vivo, disco/autoescala, passo +1 do automático, intervalo mínimo, capacidade na redução, alvo igual. `requested` antes de `scaleTo` (sem retry) → `succeeded`/`failed`; recusa = `rejected` sem `requestId`; idempotente por `requestId`; auditoria `WORKER_SCALE_REQUESTED`. `checkPreconditions()` para a P4.
- **`RequestWorkerScaleUseCase.ts`**, **`GetWorkerScaleStateUseCase.ts`**, **`ListWorkerScaleEventsUseCase.ts`**, **`application/services/WorkerScalerStateCache.ts`** — pedido manual (conectadas pela última amostra), estado com cache de 30 s por processo (POST ao vivo e invalida), histórico sem ator.
- **`presentation/routes/workerAdmin.routes.ts`**, **`schemas/workerAdmin.schema.ts`**, **`presenters/WorkerScalePresenter.ts`** — `GET`/`POST /admin/workers/scale` e `GET /admin/workers/scale/events` (super admin).

### Changed

#### API — `sessions`

- **`GetWorkerCapacityUseCase.ts`** — com `WORKER_SCALER_SERVICE_ID` a memória usa só esse serviço (id ou prefixo `<id>-`).
- **`infrastructure/lease/sessionLeaseContainer.ts`** — monta os use cases de escala; adoção = flag local OU batimento vivo (`50b0be9`: com `http`/`worker` separados a flag mora só no worker).

#### Painel (app/) — `workersAdmin`

- **`components/ScaleTab.tsx`**, **`ScaleConfirmDialog.tsx`**, **`useWorkerScale.ts`**, **`rules.ts`**, **`strings.ts`**, **`types.ts`**, **`services/adminWorkers.service.ts`**, **`pages/admin/AdminWorkersPage.tsx`**, **`routes/AppRoutes.tsx`** — aba Escala: estado e o que falta, subir/reduzir com motivo, `CooldownBar` + `serverNow()`, histórico paginado só com `Manual`/`Automática`; rascunho em `usePersistedState('workers.scale.draft')`.

#### Docs

- **`docs/workers-escala.md`** (Escala), **`docs/arquitetura-escala.md`** (§5.1 envs e checklist, §6), **`docs/ops-metricas.md`** (recorte: só as rotas de escala chamam a Render), **`docs/produto-roadmap.md`**, **`AGENTS.md`**.

## [0.83.0 · app 0.102.0] — 2026-11-11 — Capacidade dos workers e métricas de sessões

Não havia número para decidir o teto nem quantas réplicas subir, e sem adoção nenhum alerta de ocupação. O coletor passa a
gravar a ocupação de sessões do cluster, a rota de capacidade cruza o contratado por plano com o instalado e a RAM medida
(teto sugerido), e a aba Capacidade mostra os números. Spec: `.specs/features/worker-scaling/` (WSCALE-07..10, 17, 19;
fase P2). Doc: `docs/workers-escala.md` (Capacidade), `docs/ops-metricas.md`.
**Migration Prisma**: não (só comentário de fontes em `schema.prisma`). **Breaking**: não.

### Added

#### API — `metrics`

- **`metrics/infrastructure/sources/SessionsOccupancySource.ts`**, **`domain/contracts/ISessionsOccupancySource.ts`** — `sessions_connected`, `sessions_pending_login`, `sessions_awaiting`, `sessions_capacity` (fonte `sessions`, recurso `cluster`) coletadas a cada tick (60 s) e gravadas como média de 5 min, em `all`/`worker`, uma consulta com `statement_timeout` 2 s; sem adoção `awaiting` = 0 e `capacity` = teto × donos de lease.
- **`metrics/domain/OpsMetric.ts`** — fonte `sessions` e as 4 métricas em `OPS_METRIC`.
- **`metrics/domain/services/opsAlertPolicy.ts`** — motivo `session_occupancy` (`connected ÷ capacity > alertOccupancyRatio`), só log com o silêncio de 30 min por lease.

#### API — `sessions`

- **`sessions/domain/services/capacityPlan.ts`** — contas puras: `requiredReplicas`, `mbPerSession`, `suggestedMaxSessions` (0,7 × limite ÷ MB), `canScaleDownTo`, `shouldScaleUp` (P3/P4).
- **`sessions/domain/contracts/IWorkerCapacityReader.ts`**, **`infrastructure/repositories/PrismaWorkerCapacityReader.ts`** — agregado por plano de tenants `ACTIVE` (contratado, ilimitados, criadas, conectadas por canal) numa consulta; número JSON = limite; string só se casar `^\s*[0-9]{1,9}(\.[0-9]+)?\s*$` (decimal com casas aceito); outra string (hex, sinal, notação científica, mais de 9 dígitos, `.5`), ausente ou `null` = ilimitado na aba (difere de `CreateSessionUseCase`, que usa `Number()` em `PrismaEntitlementReader.toNumber`).
- **`sessions/application/use-cases/GetWorkerCapacityUseCase.ts`** — cluster pela última amostra de 1 h; MB por sessão com memória `srv-` (instâncias `srv-<id>-<sufixo>` somadas por `at`, unidade por `meta.unit`) e limite por `memory ÷ memory_pct`; mais de um `srv-` → `null`.
- **`sessions/presentation/routes/workerAdmin.routes.ts`**, **`schemas/workerAdmin.schema.ts`** — `GET /admin/workers/capacity` (super admin).

### Changed

#### API — `metrics`, `sessions`

- **`metrics/infrastructure/jobs/OpsMetricsSamplerJob.ts`**, **`opsMetricsContainer.ts`** — fonte de sessões plugada; alerta de ocupação só com a adoção desligada (com ela o `WorkerCapacityAlertJob` cobre).
- **`sessions/infrastructure/lease/sessionLeaseContainer.ts`** — monta o use case de capacidade.

#### Painel (app/) — `workersAdmin`

- **`features/workersAdmin/components/CapacityTab.tsx`**, **`useWorkerCapacity.ts`**, **`rules.ts`**, **`strings.ts`**, **`types.ts`**, **`services/adminWorkers.service.ts`** — aba Capacidade em `/admin/workers/capacity` (chunk `lazy`): cartões do cluster, tabela por plano com "cabem mais N clientes", série sessões × capacidade de 7 dias (`/admin/ops/metrics/series`), "sem amostra" sem dado.
- **`SettingsTab.tsx`**, **`SettingsConfirmDialog.tsx`**, **`useWorkerSettings.ts`** — teto sugerido na ajuda; confirmação reforçada só acima do sugerido ou sem amostra.
- **`pages/admin/AdminWorkersPage.tsx`**, **`routes/AppRoutes.tsx`** — aba nova.

#### Docs

- **`docs/workers-escala.md`** (Capacidade, alerta sem adoção), **`docs/ops-metricas.md`** (fonte `sessions`, `session_occupancy`), **`docs/produto-roadmap.md`**.

### Fixed (revisão da P2)

- **`workerAdmin.schema.ts`**, **`GetWorkerCapacityUseCase.ts`** — campo novo `cluster.stale` em `GET /admin/workers/capacity` (`true` com a última amostra há mais de 10 min).
- **`SessionsOccupancySource.ts`**, **`PrismaSessionAdoptionRepository`** — `countAwaitingCapacity(…, { statementTimeoutMs })` com teto de 2 s; falha ou timeout dela omite só `sessions_awaiting` do tick (`warn` 1× por sequência), sem derrubar as outras 3 métricas nem o alerta de ocupação.
- **`PrismaWorkerCapacityReader.ts`** — entitlement em string só vira limite com a regex `^\s*[0-9]{1,9}(\.[0-9]+)?\s*$`; outra string = ilimitado na aba.
- **`opsAlertPolicy.ts`** — `session_occupancy` loga `value`/`threshold` em percentual (0–100), como `memory`.
- **`app/…/useWorkerSettings.ts`** — medição do teto sugerido com timeout de 8 s: resposta pendurada vira `unavailable` e não trava "Revisar e salvar".
- **`aggregateOpsMetrics.ts`** — `sessions_capacity` gravada pelo último valor da janela (antes, média; as amostras anteriores seguem médias e a série de 7 dias mistura os dois na transição). Todo agregado grava `meta.agg`: `'avg'` (gauge na média) ou `'last'` (counter e `sessions_capacity`); valores não mudam.
- **`opsAlertPolicy.ts`** — `metric` do log do alerta de ocupação agora `sessions_occupancy_pct` (percentual derivado, não gravado).
- **`app/…/useWorkerSettings.ts`** — aviso de teto abaixo da ocupação só com batimentos (sessões do worker mais ocupado, sem olhar `adoptionEnabled`); sem batimento, sem aviso (total do cluster não é ocupação por worker).
- **`app/…/workersAdmin/rules.ts`**, **`CapacityTab.tsx`**, **`supportChat/routes.ts`** — planos na ordem do catálogo; botão flutuante de suporte oculto em `/admin/workers/capacity`.

## [0.82.0 · app 0.101.0] — 2026-11-11 — Configuração de escala dos workers em banco

O teto de sessões por worker (`WORKER_MAX_SESSIONS`) e os limiares de alerta eram env lida no boot: mudar exigia
redeploy, que derruba as sessões. Agora ficam em `platform_settings` (chave `worker_scaling`), ajustados pelo super admin
e lidos em runtime (refresh 30 s). Sem linha salva o comportamento é o de antes; a env vira só valor inicial.
Spec: `.specs/features/worker-scaling/` (WSCALE-01..07, 19; fase P1). Doc: `docs/workers-escala.md`.
**Migration Prisma**: sim (`20261111140000_add_audit_action_worker_scaling`, só `ALTER TYPE ... ADD VALUE`).
**Limite conhecido**: o teto só é aplicado com `WORKER_ADOPTION_ENABLED=true` (`enforced: false` sem ela).

### Added

#### API — `sessions`

- **`sessions/domain/services/workerScalingSettings.ts`** — configuração pura: 9 campos com faixa (`maxSessionsPerWorker` 1–1000, `maxPendingLoginsPerWorker` 1–500, `alertOccupancyRatio` 0,5–0,95, `awaitingAlertSeconds`, `scalerMode`, réplicas 1–20, tempos), defaults vindos da env, `resolveEffectiveSettings` com origem `default|saved` por campo; campo desconhecido rejeitado.
- **`sessions/domain/contracts/IWorkerScalingSettingsRepository.ts`**, **`IWorkerScalingSettingsProvider.ts`** — contratos de persistência e de leitura síncrona (`current()`).
- **`sessions/infrastructure/repositories/PrismaWorkerScalingSettingsRepository.ts`** — leitura/gravação em `platform_settings`; concorrência otimista por `updatedAt` (`INSERT … ON CONFLICT DO NOTHING` ou `updateMany` sem linha → conflito, sem `prisma:error`); `get()` devolve a linha crua com o `updatedAt` real, para o PUT regravar uma linha inválida.
- **`sessions/infrastructure/lease/RefreshingWorkerScalingSettingsProvider.ts`** — nasce com a env sem I/O; refresh a cada 30 s (`unref`) e na hora após salvar; leitura com teto de 5 s; falha mantém o último valor bom e loga uma vez; valor salvo inválido cai no default (igual ao GET); refresh durante leitura em curso encadeia uma nova leitura.
- **`sessions/application/use-cases/GetWorkerScalingSettingsUseCase.ts`**, **`UpdateWorkerScalingSettingsUseCase.ts`** — leitura com `origin`, `updatedAt` e `enforced` (adoção ligada no processo ou batimento vivo de algum worker, via `IWorkerHeartbeatRepository.hasAlive`; falha da consulta cai na flag local); gravação do objeto completo com `expectedUpdatedAt`, `updatedById`, auditoria antes/depois e `provider.refresh()`.
- **`sessions/presentation/routes/workerAdmin.routes.ts`**, **`schemas/workerAdmin.schema.ts`** — `GET`/`PUT /admin/workers/settings` (super admin); use cases montados no container, sem Prisma na rota.
- **`shared/errors/internal/WorkerScalingErrors.ts`** — `INVALID_WORKER_SCALING_SETTINGS` (400, `{field}`) e `WORKER_SCALING_SETTINGS_CONFLICT` (409).
- **`prisma/schema.prisma`**, **`shared/audit/IAuditLogRepository.ts`** — `AuditAction` `WORKER_SCALING_SETTINGS_CHANGED` e `WORKER_SCALE_REQUESTED` (este para a P3).

### Changed

#### API — `sessions`

- **`sessions/application/services/CapacityLimitedLeaseGate.ts`** — recebe `() => limits` e lê o teto a cada `acquire`.
- **`sessions/infrastructure/lease/sessionLeaseContainer.ts`** — singleton `workerScalingSettingsProvider()` em todo papel; gate com teto só com adoção ligada (como antes), lido do provider.
- **`sessions/infrastructure/lease/sessionAdoptionContainer.ts`**, **`AdoptNextSessionUseCase.ts`**, **`sessionAdoptionPolicy.ts`** — ticker com `maxSessions()` por tick; `capacityAlertReason` recebe `ratio` e `awaitingSeconds` (constantes viram default).
- **`sessions/infrastructure/jobs/WorkerHeartbeatJob.ts`**, **`WorkerCapacityAlertJob.ts`** — teto gravado e limiares lidos da configuração a cada tick.
- **`app/roleComposition.ts`** — pausa do `session-open` compara com o teto do provider a cada checagem.
- **`app/server.ts`** — `refresh()` (teto de 5 s no boot, segue com a env) + `start()` do provider antes do boot das sessões; `stop()` no shutdown; registro do worker com o teto da configuração.
- **`shared/config/workerAdoption.ts`** — `workerAdoptionConfig()` sem os tetos; `workerScalingEnvDefaults()` é o único ponto que lê `WORKER_MAX_*`, limitando à faixa do domínio (1000/500) com `warn`.

#### Painel (app/) — `workersAdmin`

- **`features/workersAdmin/types.ts`**, **`rules.ts`**, **`strings.ts`**, **`services/adminWorkers.service.ts`** — contrato, faixas espelhadas da API, validação e diff do rascunho, textos pt-BR.
- **`features/workersAdmin/useWorkerSettings.ts`** — carga, rascunho em `usePersistedState` (`workers.settings.draft`, `tab`), 409 recarrega e descarta, 400 marca o campo.
- **`features/workersAdmin/components/SettingsTab.tsx`**, **`SettingsConfirmDialog.tsx`** — formulário com ajuda por campo, `RangeSlider` de réplicas, diff na confirmação, valor digitado para mudar o teto, aviso abaixo da ocupação e faixa "sem efeito" sem adoção.
- **`pages/admin/AdminWorkersPage.tsx`**, **`routes/AppRoutes.tsx`** — aba Configuração em `/admin/workers/settings` (chunk `lazy`), abas pela URL roláveis com setas no celular.
- **`features/supportChat/routes.ts`** — botão de suporte oculto em `/admin/workers/settings` (ação no rodapé do formulário).
- **`components/RangeSlider.tsx`** — prop opcional `describedBy` (`aria-describedby` nos cursores).

#### Docs

- **`docs/workers-escala.md`** (novo), **`docs/arquitetura-escala.md`** (env `WORKER_MAX_*` = valor inicial), **`docs/produto-roadmap.md`** (Gestão de workers), **`AGENTS.md`**.

## [0.81.0 · app 0.100.0] — 2026-11-11 — Link de afiliado sempre do tenant (recriado a partir de qualquer link do produto)

Gerador, Página de Ofertas e Story recusavam link de outro afiliado (`OFFER_LINK_NOT_OWNED`) ou sem afiliação
(`OFFER_LINK_NOT_AFFILIATE`), e a Shopee passava o link colado sem conferência. Agora o tenant cola qualquer link do
produto e o link da oferta sai sempre com a conta de afiliado dele. Spec: `.specs/features/tenant-affiliate-link/`
(TLINK-01..24). Doc: `docs/gerador-de-ofertas.md` ("Link do tenant"). **Migration Prisma**: não.

### Added

#### API — `campaigns`

- **`campaigns/application/services/TenantAffiliateLinkComposer.ts`** — núcleo do link do tenant extraído do `BuildTenantAffiliateLinkUseCase` (switch por marketplace + vitrine social do ML), sem expandir, sem gate de plano, sem `markRejected` e sem log de URL. Usado pelo monitoramento e pelo `ResolveAffiliateProductUseCase`; aceita `mlTag` (etiqueta vinculada do link).
- **`campaigns/domain/services/shouldKeepPastedLink.ts`**, **`isShortLink.ts`** — regra pura: o link colado só fica quando é link curto oficial (`meli.la`, `onelink`…) e `verified` como do tenant; Amazon sempre reescrita. `isShortLink` saiu do `HttpShortLinkExpander` para o domínio (o expander importa de lá).
- **`campaigns/domain/services/findForeignMarketplaceLinks.ts`**, **`extractUrls.ts`** — links de marketplace acrescentados no texto editado que não são o `affiliateUrl`; `extractUrls` (com `URL_PATTERN`, `TRAILING`, `toHref`, `FoundUrl`) mudou de `automation/domain/services/offerMessageText.ts` para campaigns (o original reexporta).
- **`shared/errors/internal/OfferErrors.ts`** — `AFFILIATE_CREDENTIAL_REQUIRED` (422, `{provider}`), `OFFER_LINK_REBUILD_FAILED` (422, `{provider, reason}`), `OFFER_TEXT_FOREIGN_LINK` (422, `{}`).
- **`shared/errors/internal/StorefrontErrors.ts`** — `STOREFRONT_OFFER_LINK_UNVERIFIED` (409).
- **`shared/http/rateLimitPresets.ts`**, **`offer.routes.ts`** — preset `offerGenerate`: `POST /campaigns/offers` com 60/h por tenant por instância (`perTenantRateLimit`, 429 `RATE_LIMITED`); a cota diária só conta oferta gravada.

#### Painel (app/) — `affiliateLinks`

- **`features/affiliateLinks/linkErrors.ts`**, **`strings.ts`** — fonte única de texto e ação (`describeAffiliateLinkError`) dos erros de link de afiliado, por loja, para gerador, vitrine e story.
- **`components/ConnectStoreAction.tsx`** — botão "Conectar <loja>" para `/affiliates/credentials?returnTo=<tela>`.
- **`components/LinkRebuiltNotice.tsx`** — aviso "Link recriado com a sua conta …" (`AppIcon` + `Tooltip`), sem URL.
- **`types/api.types.ts`** — `linkRebuilt` nas respostas.

### Changed

#### API — `campaigns`, `storefront`, `offer-story`

- **`ResolveAffiliateProductUseCase.ts`** — deixa de classificar e recusar: mantém só o link curto oficial já do tenant, senão recria pelo composer nos 4 marketplaces; `resolveState` nos 4 (ausente → `AFFILIATE_CREDENTIAL_REQUIRED`, recusada → `AFFILIATE_CREDENTIAL_REJECTED` sem chamar a loja e sem pausar); allowlist `isSupportedShareLink` do link devolvido nos 4 (fora → `OFFER_LINK_REBUILD_FAILED`); etiqueta vinculada do ML mantida na recriação; devolve `linkRebuilt` e `attributionVerified` sempre `true`. Sai `generateMlAffiliateLink` (engolia erro) e a troca própria da Shein.
- **`BuildTenantAffiliateLinkUseCase.ts`** — passa a delegar ao composer; contrato e resultados do monitoramento idênticos (TLINK-23).
- **`GenerateOfferUseCase.ts`**, **`offersContainer.ts`**, **`offer.schema.ts`** — gerador recebe o resolvedor do container (sem instância própria) e devolve `linkRebuilt` no envelope da geração; `toOfferDto` não muda.
- **`UpdateOfferUseCase.ts`** — texto editado com link de marketplace acrescentado → `OFFER_TEXT_FOREIGN_LINK`; links que já estavam no texto ficam.
- **`pickPreviewUrl.ts`** — prévia de link só com o `affiliateUrl` presente no texto; senão sem prévia (antes caía no primeiro link).
- **`ExtractStorefrontOfferUseCase.ts`**, **`storefrontUseCaseDeps.ts`**, **`storefrontContainer.ts`**, **`storefront.routes.ts`**, **`storefront.schema.ts`** — vitrine usa só o resultado do Resolve (item nasce `attributionVerified = true`); criação responde `data: { ...item, linkRebuilt }`.
- **`SetStorefrontOfferStatusUseCase.ts`** — publicar item legado com `attributionVerified = false` → `STOREFRONT_OFFER_LINK_UNVERIFIED`.
- **`RenderOfferStoryUseCase.ts`**, **`offerStory.schema.ts`** — story devolve `linkRebuilt`; erros de link sobem com o status original.

#### Painel (app/) — `offers`, `storefront`, `offerStory`

- **`OfferGeneratorForm.tsx`**, **`offers/strings.ts`**, **`offerErrors.ts`**, **`useOfferGenerator.ts`**, **`OfferResultPanel.tsx`**, **`OfferGeneratorPage.tsx`** — campo "Link do produto" aceita qualquer link; sai o aviso fixo da Shopee; erros pelo módulo comum (botão de credenciais com `returnTo`); aviso de link recriado na prévia.
- **`AddOfferCard.tsx`**, **`useStorefrontPage.ts`**, **`storefrontForm.ts`**, **`storefront/strings.ts`**, **`storefront/types.ts`**, **`StorefrontPage.tsx`**, **`storefront.service.ts`** — erro com ação "Conectar <loja>" abaixo do campo; aviso ao adicionar item recriado; selo "comissão não verificada" só para legado.
- **`ProductStep.tsx`**, **`ResultStep.tsx`**, **`useOfferStoryWizard.ts`**, **`productForm.ts`**, **`offerStory/strings.ts`**, **`offerStory/types.ts`**, **`OfferStoryPage.tsx`** — story aceita link de outro afiliado, erros pelo módulo comum e aviso no resultado.

### Removed

- **`OfferErrors.ts`** — `OFFER_LINK_NOT_OWNED` e `OFFER_LINK_NOT_AFFILIATE` (classes e mapeamentos no painel).
- **`ExtractStorefrontOfferUseCase.ts`** / **`storefrontContainer.ts`** — troca própria da Shopee via `BuildTenantAffiliateLinkUseCase` e gravação do link colado com `attributionVerified = false`.
- **`OfferGeneratorForm.tsx`** — `shopeeNotice` (aviso fixo "comissão não verificada" da Shopee).

### Fixed

- **`ResolveAffiliateProductUseCase.ts`** — falha da geração automática do ML era engolida e caía em `OFFER_LINK_NOT_AFFILIATE`; credencial recusada só era lida na Shein (demais chamavam a loja de novo). Agora o erro da loja sobe e a recusa é lida por `resolveState` nos 4.
- **`pickPreviewUrl.ts`** — a prévia podia divulgar link do texto que não era do tenant.

### Breaking Changes

- Códigos `OFFER_LINK_NOT_OWNED` e `OFFER_LINK_NOT_AFFILIATE` deixam de existir; clientes devem tratar `AFFILIATE_CREDENTIAL_REQUIRED`, `OFFER_LINK_REBUILD_FAILED` e `OFFER_TEXT_FOREIGN_LINK`.
- Link não verificado (`unverified`) deixa de passar: oferta nova sempre com link do tenant; item legado de vitrine não verificado não publica (`STOREFRONT_OFFER_LINK_UNVERIFIED`).
- Loja sem credencial utilizável bloqueia gerador, vitrine e story (`AFFILIATE_CREDENTIAL_REQUIRED`) em vez de passar o link colado.
- Shopee sem acesso aprovado à Open API deixa de gerar oferta (`AFFILIATE_API_ACCESS_DENIED`); liberar no painel de afiliado da Shopee.
- Resposta de `POST /campaigns/offers` ganha `linkRebuilt` no envelope; criação da vitrine (dentro de `data`) e story também. `POST /campaigns/offers` passa a ter limite de 60/h por tenant.
- Sem migration; `attributionVerified` e `sourceUrl` ficam (legado e auditoria). Restart da API: sim (deploy normal).

---

## [0.80.0 · app 0.99.0] — 2026-11-11 — Várias etiquetas do Mercado Livre por plano (LITE 1, PRO 2, MAX 10)

Link do ML com etiqueta da própria conta que não era a `in_use` era recusado como de terceiro. Agora o tenant vincula
etiquetas da conta até o limite do plano. Spec: `.specs/features/tenant-affiliate-link/` (TLINK-28..39). Doc:
`docs/integracoes-credenciais-afiliado.md` ("Várias etiquetas do Mercado Livre").

### Added

#### API — `tenants`, `integrations`, `extension`, `campaigns`

- **`tenants/domain/entitlementKeys.ts`**, **`planPresets.ts`**, **`domain/services/affiliateIdentifierLimit.ts`** — chave `mercado_livre_affiliate_tags` (LITE 1, PRO 2, MAX 10, principal incluída); `identifierLimitOf`: ausente/`null` vale 1, nunca ilimitado.
- **`prisma/schema.prisma`** + migration **`20261111130000_add_affiliate_account_identifiers_and_ml_tags_entitlement`** — colunas `accountIdentifiers`/`linkedIdentifiers` (`TEXT[]`, default vazio) em `affiliate_credentials`; presets da chave nova (`ON CONFLICT DO NOTHING`) e backfill em `tenant_entitlements` por `planSlug`, filtrado pela chave nova (nenhuma outra chave muda).
- **`MercadoLivreAffiliateClient.ts`** / **`IMercadoLivreAffiliateClient.ts`** — `listAccountTags` (`{ tags, active }`; `tags: null` quando a leitura falha, 401/403/429 lançam); `getActiveTag` delega.
- **`integrations/domain/services/effectiveLinkedIdentifiers.ts`** — regra pura: principal + primeiras `limite − 1` vinculadas (rebaixamento não apaga).
- **`extension.routes.ts`**, **`UpsertAffiliateSessionUseCase.ts`**, **`PrismaAffiliateCredentialRepository.ts`**, entidade/DTO/mapper — o sync grava a lista da conta (itens validados, repetidos descartados) e poda vinculadas que saíram dela; lista nula ou vazia não toca; `clearSession` zera as duas colunas.
- **`GetAffiliateIdentifiersUseCase.ts`**, **`SetLinkedAffiliateIdentifiersUseCase.ts`**, **`affiliateCredential.routes.ts`**, **`affiliateCredential.schema.ts`**, **`AffiliateCredentialPresenter.ts`**, **`affiliateIdentifierEntitlement.ts`** — `GET|PUT /integrations/affiliate-credentials/:provider/identifiers`; PUT só com etiquetas da conta, sem repetição, até o limite (`PLAN_LIMIT_REACHED`); auditoria `AFFILIATE_CREDENTIAL_UPSERTED` sem as etiquetas. Listagem com `accountIdentifiers`, `linkedIdentifiers`, `identifierLimit`.
- **`subscriptionLimits.ts`**, **`PrismaTenantUsageReader.ts`** — Assinatura mostra etiquetas do ML com uso (conjunto efetivo) × limite.
- **`ResolveAffiliateProductUseCase.ts`**, **`verifyAffiliateLink.ts`**, **`ResolveAffiliateCredentialUseCase.ts`**, **`IAffiliateCredentialResolver.ts`**, **`AffiliateCredentialErrors.ts`** — gerador, vitrine e story aceitam qualquer etiqueta vinculada efetiva; etiqueta da conta não vinculada → `AFFILIATE_IDENTIFIER_NOT_LINKED` (com vaga) ou `PLAN_LIMIT_REACHED` (sem vaga). Monitoramento e links gerados seguem com a principal.
- Teste real (TE0) em `docs/extensao-ml-endpoints.md` §4: `createLink` aceita qualquer etiqueta da conta; etiqueta fora da conta vira a `in_use` sem erro.

#### Painel (app/) — `plans`, `subscription`, `linkRotation`, `offers`, `storefront`, `offerStory`, `settings`

- **`plans/catalog.ts`**, **`PlanCard.tsx`**, **`PlansHero.tsx`**, **`plans/strings.ts`** — `limits.mercadoLivreTags` 1/2/10; linha "Etiquetas do Mercado Livre" no card; selo "PRO+" no logo do ML no banner (mapa `PROVIDER_SEAL`); `?feature=mercadoLivreTags`.
- **`subscription/strings.ts`** — rótulo e campo de catálogo da chave nova.
- **`linkRotation/planUpsell.ts`**, **`PlanLimitBanner.tsx`**, **`linkRotation/strings.ts`** — kind `mercadoLivreTags`; `plansAbove`/`UPSELL_CONFIG`: o aviso lista PRO **e** MAX (kinds antigos seguem com um plano).
- **`offers/utils/offerErrors.ts`**, **`plans/planGate.ts`**, **`OfferGeneratorPage.tsx`**, **`storefrontForm.ts`**, **`useStorefrontPage.ts`**, **`AddOfferCard.tsx`**, **`offerStory/productForm.ts`**, **`ProductStep.tsx`** — erros novos nas três telas: não vinculada → botão para credenciais; sem vaga → aviso de upgrade (gerador) ou texto + link para planos (vitrine e story).
- **`settings/components/BrowserSessionCredentialDialog.tsx`**, **`AffiliateCredentialCard.tsx`**, **`useAffiliateCredentials.ts`**, **`affiliateCredential.service.ts`**, **`privacyFlags.ts`** — tela de credenciais lista as etiquetas da conta (vindas da API), escolha da principal e das vinculadas com contador "x de y" e botão para planos no limite; flag `affiliateCredentials.accountIdentifiers` com `Blurred`; rascunho em `usePersistedState`.

### Breaking Changes / Migration

- **Migration Prisma**: `20261111130000_add_affiliate_account_identifiers_and_ml_tags_entitlement` (aditiva; colunas + presets + backfill). Aplicada no boot pela Render (`start:migrate`); nunca rodar local (`api/.env` = produção).
- **Respostas de erro novas**: `AFFILIATE_IDENTIFIER_NOT_LINKED` (422, `meta { provider, limit, used }`) e `PLAN_LIMIT_REACHED` (403, `meta.key = mercado_livre_affiliate_tags`) em `POST /campaigns/offers`, vitrine e story, para link do ML com etiqueta da conta não vinculada (antes `OFFER_LINK_NOT_OWNED`). Painel 0.99.0 trata as duas; publicar API e painel juntos.
- Contrato da listagem de credenciais ganha campos (aditivo).

## [0.79.1 · app 0.98.0] — 2026-11-11 — Link próprio do ML com apelido do perfil ≠ etiqueta volta a ser aceito

### Fixed

#### API — `campaigns`

- **`campaigns/domain/services/verifyAffiliateLink.ts`** — link próprio do Mercado Livre era recusado (`OFFER_LINK_NOT_OWNED`) quando o apelido do perfil diferia da etiqueta (ex.: `/social/sevenclub?matt_word=sevenclub2025`). Causa raiz: `/social/<x>` (apelido do perfil) e `matt_word` (etiqueta) contavam juntos como identificadores de dono; dois valores distintos → `not_owned`, mesmo com `matt_word` = etiqueta do tenant. Em produção 84 de 86 URLs sociais têm apelido ≠ etiqueta. Nova função pura `ownershipIdentifiersOf`: no ML, havendo `matt_word` em qualquer URL (colada ou final), só ele conta; `/social/<x>` vale apenas sem nenhum `matt_word`. Dois `matt_word` distintos seguem `not_owned`; Amazon, Shein e Shopee inalterados; monitoramento não usa a função. Testes em `verifyAffiliateLink.test.ts` e `ResolveAffiliateProductUseCase.test.ts`. Doc: `docs/gerador-de-ofertas.md`.

## [0.78.2 · app 0.96.3] — 2026-11-10 — Extensão reinstalada volta a conectar

### Fixed

#### API — `extension`

- **`extensionAuthHook.ts`** — cookie de sessão sobrevive à reinstalação da extensão (novo `installationId`): a instalação nova parecia vinculada, o assistente pulava "Vincular" e o consentimento por instalação dava 404 (ML "A sincronização falhou no servidor", Shein "vinculada a outro usuário"; heartbeat creditado à instalação antiga). Agora `X-Installation-Id` ≠ instalação da sessão → 401 `INVALID_EXT_SESSION`: a extensão se declara sem vínculo e o painel oferece "Vincular". Teste em `extensionHooks.test.ts`.

#### Painel (app/) — `extension`, `settings`

- **`ExtensionSetupWizard.tsx`** — 404 `SESSION_NOT_FOUND` no sync volta para "Vincular" com `errors.relinkRequired`; "Pular por enquanto" limpa o erro; "Pronto" sem sync mostra `doneHintNotSynced` em vez de prometer renovação automática.
- **`strings.ts`** (extension e settings) — `relinkRequired`, `doneHintNotSynced`; `noLinkError` deixa de afirmar "outro usuário" (o caso comum é reinstalação). Docs: `docs/extensao-navegador.md`.

## [app 0.96.2] — 2026-11-10 — Extensão: desconectar volta a funcionar

### Fixed

#### Painel (app/) — `extension`, `settings`

- **`extensionApi.ts`** / **`useExtension.ts`** — "Desconectar extensão" chamava `DELETE /extension/session` com `x-client: web`; a rota é só da extensão e respondia 403 `EXTENSION_ONLY`, que o `fetch` engolia: nada acontecia (nenhuma sessão com `revokedAt` em produção). Agora revoga pelo Bearer a sessão da instalação (`GET /extension/sessions` → `DELETE /extension/sessions/:id`).
- **`ExtensionSettingsPage.tsx`** — erro ao desconectar aparece (`settings.disconnectFailed`); antes a rejeição ficava sem tratamento.
- **`ExtensionMlCard.tsx`** — "Desconectar Mercado Livre" já funcionava no servidor, mas a tela não mudava (etiqueta mantida, chip "Logado" é o login do navegador): aviso de sucesso `ml.disconnected`.
- **`useAffiliateCredentials.ts`** / **`AffiliateCredentialsPage.tsx`** — corrige a 0.96.1: a rota do ML revoga o consentimento mas mantém a linha, então a lixeira agora revoga **e depois** apaga (`beforeRemove`); só a rota faria o card voltar ao recarregar.
- **`strings.ts`** — `settings.disconnectFailed`, `settings.cancel`, `ml.disconnected`, `ml.cancel` (saem os "Cancelar" fixos). Testes: `extensionApi.test.ts`, `useExtension.test.ts`, `useAffiliateCredentials.test.ts`. Docs: `docs/extensao-navegador.md`, `docs/integracoes-credenciais-afiliado.md`.

## [app 0.96.1] — 2026-11-10 — Credenciais: remover Mercado Livre revoga a extensão

### Fixed

#### Painel (app/)

- **`AffiliateCredentialsPage.tsx`** / **`useAffiliateCredentials.ts`** — a lixeira do Mercado Livre chamava o `DELETE` genérico, que apaga a credencial mas deixa o consentimento da extensão: o sync seguinte recriava o card (produção: removida 20:41, recriada 20:43). Agora usa a rota do marketplace (`DELETE /extension/marketplaces/ml/session`, revoga e apaga). `remove` aceita `removeOp`; teste em `useAffiliateCredentials.test.ts`. Doc: `docs/integracoes-credenciais-afiliado.md`.

## [app 0.96.0] — 2026-11-10 — Planos: logos dos marketplaces no banner

### Added

#### Painel (app/)

- **`PlansHero.tsx`** — banner da vitrine de planos mostra as logos de Shopee, Mercado Livre, Amazon e Shein (lista de `AFFILIATE_PROVIDERS`), com nome no tooltip e no leitor de tela; Shein com selo `MAX`. Textos em `features/plans/strings.ts`; teste em `PlansHero.test.tsx` (claro e escuro).

## [app 0.95.1] — 2026-11-10 — Credenciais: 4 cards numa linha no desktop

### Fixed

#### Painel (app/)

- **`AffiliateCredentialsPage.tsx`** — com o menu aberto em 100% de zoom (janela < 1536 px) os 4 cards (Shopee, Mercado Livre, Amazon, Shein) quebravam em 2×2, porque a coluna de 4 dependia do breakpoint `xl` da janela. A grade passa a usar container query sobre a área de conteúdo: 1 coluna < 600 px, 2 colunas até 1080 px, 4 colunas acima. Celular segue com os cards em carrossel (`SwipeCards`).

## [0.78.1] — 2026-11-10 — Fila: gerador à frente do monitoramento

### Changed

#### Fila de envio (`campaigns`)

- **`PrismaOfferDispatchRepository.ts`** — `claimDue` ordena a cabeça de cada faixa com o gerador antes do monitoramento (`od."origin" <> 'GENERATOR'` antes de `waitingSessionSince`/`notBefore`; `IN (offers)` virou `JOIN`). Problema: oferta manual entrava atrás de ~4 mil capturas vencidas por sessão e esperaria ~16 h. Intervalo da sessão mantido; custo da consulta igual (~40 ms, 13 mil `QUEUED`).
- **`IOfferDispatchRepository.ts`** / **`PrismaOfferDispatchRepository.ts`** / **`offerTestFakes.ts`** — `openNotBefore` aceita `origin` opcional.
- **`SendOfferUseCase.ts`** / **`OfferSendControlUseCases.ts`** (retomar) — oferta do gerador calcula o fim da faixa só com envios do gerador: a fila do monitoramento não empurra o horário previsto.
- Testes: `PrismaOfferDispatchRepository.int.test.ts` (prioridade e `openNotBefore` por origem), `SendOfferUseCase.test.ts`. Docs: `docs/fila-de-envio.md` §2.4, `docs/gerador-de-ofertas.md`.

## [0.78.0] — 2026-11-10 — Afiliado Shein

> app 0.95.0 · extensão 3.4.0 (ver `extension/CHANGELOG.md`). Doc: `docs/afiliado-shein.md`. Shein não tem API de
> afiliados: o link vem de endpoint interno com a sessão do afiliado, proibido pelos termos da SHEIN (3.3.2, Anexo 3
> §6) — risco assumido pelo tenant com aceite registrado. Nada ligado em produção sem o dono; smoke T16 pendente.

### Added

#### Backend — integrations (provider SHEIN e aviso de risco)

- **`AffiliateProvider.ts`**, **`affiliateProviderFields.ts`** — `SHEIN` (ID `^\d{6,15}$`, sem secret, com sessão) e `providerIdentifierFollowsSession` (ID segue a sessão).
- **`marketplaceRiskNotice.ts`** — versão vigente do aviso por marketplace (`SHEIN: '2026-11-10'`), `requiresRiskAcceptance`. Texto vive no painel, que espelha a versão.
- **`AcceptMarketplaceRiskUseCase.ts`** — só administrador do tenant aceita (operador e super admin → 403); versão ≠ vigente → 409 `MARKETPLACE_RISK_NOTICE_OUTDATED`; reaceite da mesma versão devolve o existente; audita `MARKETPLACE_RISK_ACCEPTED`.
- **`requireMarketplaceRiskAccepted.ts`**, **`MarketplaceRiskErrors.ts`** — `MARKETPLACE_RISK_NOT_ACCEPTED` (403).
- **`IMarketplaceRiskAcceptanceRepository.ts`**, **`PrismaMarketplaceRiskAcceptanceRepository.ts`** (+ mapper) — só inclusão (sem update/delete), toda consulta com `tenantId`.
- **`affiliateCredential.routes.ts`** — `POST /integrations/affiliate-credentials/:provider/risk-acceptance`. **`marketplaceRiskAdmin.routes.ts`** — `GET /admin/tenants/:tenantId/marketplace-risk-acceptances` (super admin).
- **`sheinSessionMemberId.ts`** — lê o `memberId` (`m`) do payload do token `AT`.

#### Backend — tenants (entitlement e edição por plano)

- **`entitlementKeys.ts`**, **`planPresets.ts`** — `marketplace_shein_enabled` (LITE/PRO false, MAX true; ausente = bloqueado). **`subscriptionLimits.ts`** — linha do recurso.
- **`adminEditableEntitlements.ts`** — allowlist de chaves editáveis pelo super admin (hoje só `marketplace_shein_enabled`).
- **`IPlanEntitlementPresetRepository.ts`**, **`PrismaPlanEntitlementPresetRepository.ts`**, **`planEntitlementTransaction.ts`** — presets lidos/gravados por repositório; `setForPlan` atualiza preset + tenants do plano numa transação.
- **`ListAdminPlanEntitlementsUseCase.ts`**, **`SetPlanEntitlementUseCase.ts`**, **`planEntitlementAdmin.routes.ts`** — `GET /admin/plan-entitlements` e `PUT /admin/plan-entitlements/:planSlug/:key`; chave fora da allowlist → 400; audita `PLAN_ENTITLEMENT_CHANGED`; não chama a central.

#### Backend — campaigns (gerador, vitrine, story)

- **`ISheinAffiliateClient.ts`**, **`SheinAffiliateClient.ts`** — `POST m.shein.com/br/affiliate/api/goods/recommend/detailNew` (URL fixa, 8 s, ≤ 256 KiB, `redirect: 'manual'`): link (`shareLink` só em `onelink.shein.com`) + título, preço, preço cheio e foto numa chamada. 401/403/`100105` → credencial recusada; 3xx/5xx/timeout/JSON inválido → indisponível; outro `code` → `null`. Log só com código.
- **`detectMarketplace.ts`**, **`parseProductRef.ts`**, **`verifyAffiliateLink.ts`** — hosts `br.shein.com`, `m.shein.com` (só `/br/`), `onelink.shein.com`; `goodsId` do `-p-<id>.html`; dono por `url_from=affiliate_koc_<id>`.
- **`isSupportedShareLink.ts`** — `shareLink` devolvido pela loja passa na mesma allowlist da URL colada.
- **`marketplaceEntitlement.ts`**, **`requireMarketplaceEnabled.ts`** — gate de plano por marketplace (`PLAN_FEATURE_UNAVAILABLE`).
- **`IMarketplaceRiskGate.ts`** — porta obrigatória nas 3 instâncias do resolver/builder (`offersContainer.ts`, `GenerateOfferUseCase.ts`).
- **`ResolveAffiliateProductUseCase.ts`** — ramo SHEIN: plano (antes de expandir) → credencial → aceite → 1 chamada; link gerado sai com `attributionVerified = true`; sem conta, link com afiliação segue sem dados.
- **`BuildTenantAffiliateLinkUseCase.ts`** — kinds `plan_unavailable` e `risk_not_accepted`; `sourceUrl` montada só com o id; `null` → `SHEIN_LINK_NOT_CREATED`.

#### Backend — automation (monitoramento)

- **`CapturedOffer.ts`**, **`IMonitorPorts.ts`**, **`ProcessPendingCapturedOffersUseCase.ts`** — `SKIPPED` com `MARKETPLACE_PLAN_UNAVAILABLE` / `MARKETPLACE_RISK_NOT_ACCEPTED` (retryable), em ramo próprio: o link Shein não some em silêncio.
- **`GroupMonitorConfigUseCases.ts`**, **`PrismaCapturedOfferRepository.ts`**, **`GroupMonitorDTO.ts`**, **`groupMonitoring.schema.ts`** — alerta `RISK_NOT_ACCEPTED` em `credentialAlerts` (só com credencial e sem aceite; `REJECTED` tem precedência).

#### Backend — extension (sessão Shein)

- **`SyncSheinSessionUseCase.ts`** — consentimento → aceite → plano → vínculo → ID do token (≠ cookie `memberId` → 422) → upsert cifrado → releitura do consentimento (revogado no meio → apaga a credencial e 403).
- **`extension.routes.ts`** — `PUT /extension/marketplaces/shein/session` (cookies `AT`/`memberId`, resposta `{ affiliateId }`), `POST …/shein/consent` (plano e aceite antes de gravar) e `DELETE …/shein/session` (revoga e apaga a credencial; 204 idempotente), por fábrica parametrizada.
- **`MarketplaceConsentUseCases.ts`**, **`IExtensionSessionRepository.ts`**, **`PrismaExtensionSessionRepository.ts`**, **`ExtensionSession.ts`**, **`extensionAuthHook.ts`** — consentimento por marketplace (`sheinConsentAt`, `hasConsent`).
- **`GetExtensionProfileUseCase.ts`** — permissão `shein.session` quando o tenant tem o plano. **`IExtensionEntitlementReader.ts`** — `hasMarketplace(tenantId, provider)`. **`constants.ts`** — `SHEIN_SESSION_COOKIES`.

#### Frontend — app 0.95.0

- **`AdminPlanEntitlementsPage.tsx`**, **`features/planEntitlementsAdmin/`**, **`adminPlanEntitlements.service.ts`**, **`AppRoutes.tsx`**, **`navigation/model.ts`** — `/admin/plan-entitlements` (super admin, seção Plataforma): chave × plano com `<Switch>`.
- **`features/settings/`**, **`AffiliateCredentialsPage.tsx`**, **`affiliateCredential.service.ts`**, **`api.types.ts`** — card Shein (travado por plano com selos vindos da API, sem extensão, sem vínculo, pronto, conectado, recusada, reaceite), aviso de risco fixo (com "Aceito em …"), diálogo de aceite (caixa desmarcada, só admin confirma, fora de `usePersistedState`; `riskNotice` ausente = aceite pendente; versão da API ≠ painel ou 409 `MARKETPLACE_RISK_NOTICE_OUTDATED` → só "Recarregar página"), conexão aceite → `/consent` → `shein.requestAccess` → espera pelo clique no ícone (`setTimeout` encadeado, retomada ao montar por `shein.status` `pending`), ID só mascarado com `Blurred`, desconectar pela rota da extensão; `marketplaceAvailability`; guarda de ordem em `useAffiliateCredentials.load` e `useExtension.refresh`.
- **`features/extension/contract/channel.ts`**, **`useExtension.ts`**, **`features/extension/strings.ts`** — ops `shein.*`, `supports(cap)`, mensagens dos novos `SyncErrorCode`.
- **`monitoring/strings.ts`**, **`CredentialAlerts.tsx`**, **`storefront/{types,strings}.ts`**, **`offerStore.ts`**, **`subscription/strings.ts`**, **`plans/catalog.ts`** — rótulo Shein, motivos e alerta novos, hosts, benefício MAX.

### Changed

- **`UpsertAffiliateSessionUseCase.ts`**, **`PrismaAffiliateCredentialRepository.ts`** — cookie de troca de token por provider (`ssid` × `AT`); `sessionIdentifier` substitui o `publicIdentifier` (create e update) para provider cujo ID segue a sessão.
- **`UpsertAffiliateCredentialUseCase.ts`**, **`affiliateCredential.routes.ts`** — rotas genéricas recusam SHEIN: `PUT /:provider` e `PUT /:provider/session` → 422; `DELETE /:provider` → 409 `USE_MARKETPLACE_DISCONNECT`.
- **`ListAffiliateCredentialsUseCase.ts`**, **`AffiliateCredentialPresenter.ts`**, **`affiliateCredential.schema.ts`** — listagem ganha `marketplaceAvailability` (`enabled`, `plans`, `riskNotice`).
- **`HttpShortLinkExpander.ts`** — `onelink.shein.com`: só GET, corpo ≤ 32 KiB, `input#url` vira a URL final sem nova requisição. **`HttpProductPageReader.ts`** — host Shein → `null` (página nunca lida). **`HttpOfferImageFetcher.ts`** — `ltwebstatic.com`.
- **`ResolveProductDataUseCase.ts`** — `productRefOf` com `goodsId`; SHEIN não chama o leitor de página. **`CampaignsMonitorAdapters.ts`** — não decifra sessão Shein para leitura de produto.
- **`IssueExtensionSessionUseCase.ts`** — re-vínculo a outro tenant zera `sheinConsentAt`.
- **`seed.ts`** — chave da allowlist admin com `update: {}` (seed não desfaz decisão do super admin).
- **`IAuditLogRepository.ts`** — `PLAN_ENTITLEMENT_CHANGED`, `MARKETPLACE_RISK_ACCEPTED`.

### Fixed

- **`BuildTenantAffiliateLinkUseCase.ts`**, **`ResolveAffiliateProductUseCase.ts`** — gate de plano antes de expandir (link curto Shein não é buscado sem plano); credencial já recusada não chama a Shein no gerador; `shareLink` revalidado.
- **`GroupMonitorConfigUseCases.ts`** — alerta de aceite some quando o aceite existe ou não há credencial.
- **`SyncSheinSessionUseCase.ts`**, **`PrismaExtensionSessionRepository.ts`** — corrida do sync com "Desconectar" preserva o consentimento de outras instalações do tenant.

### Breaking Changes

- Nenhuma de contrato público. Rotas e campos novos são adições; `marketplaceAvailability` é campo novo na listagem. Rotas genéricas passam a recusar só o provider novo `SHEIN`.

### Migration

- **`20261111090000_add_shein_affiliate_provider`** — `AffiliateProvider` ganha `SHEIN` (arquivo próprio: valor de enum não usável na mesma transação).
- **`20261111090100_add_shein_extension_consent`** — coluna `extension_sessions.sheinConsentAt`.
- **`20261111090200_add_audit_action_plan_entitlement_changed`** — `AuditAction` ganha `PLAN_ENTITLEMENT_CHANGED`.
- **`20261111090300_add_audit_action_marketplace_risk_accepted`** — `AuditAction` ganha `MARKETPLACE_RISK_ACCEPTED`.
- **`20261111090400_create_marketplace_risk_acceptances`** — tabela de aceites (único por tenant+provider+versão; FK tenant `CASCADE`, usuário `RESTRICT`).
- **`20261111090500_add_marketplace_shein_entitlement`** — presets `marketplace_shein_enabled` (false/false/true) + backfill dos tenants pelo preset vigente, `ON CONFLICT DO NOTHING`.

---

## [0.77.0] — 2026-11-10 — Reescrita com IA só no PRO e no MAX

### Changed

#### Backend — planos, gerador e monitoramento

- **`planPresets.ts`** — `ai_rewrite_enabled` false no LITE (PRO/MAX true; ausente segue liberado).
- **`OfferTextComposer.ts`** — trava única do plano antes de chamar a IA: com `false`, sai o modelo fixo (`aiErrorCode` `AI_PLAN_UNAVAILABLE`), inclusive com chave própria do tenant. Cobre gerar, gerar novamente e monitoramento.
- **`GroupMonitorConfigUseCases.ts`** — `limits.aiRewriteEnabled`; salvar IA no LITE grava Modelo/STANDARD sem recusar. **`ProcessPendingCapturedOffersUseCase.ts`** — config IA salva no LITE compõe como Modelo, sem selo de falha.
- **`OfferGeneratorConfigUseCases.ts`**, **`offer.schema.ts`** — `aiRewriteEnabled` na config do gerador.

#### Frontend — app 0.94.0

- **`MonitoringSettingsForm.tsx`**, **`settingsDraft.ts`** — card "Reescrita com IA" travado no LITE com selos PRO MAX e aviso; IA salva vale como Modelo; setas pulam o modo travado.
- **`AudiencePicker.tsx`**, **`OfferGeneratorForm.tsx`**, **`OfferResultPanel.tsx`**, **`OfferGeneratorPage.tsx`** — no LITE só "Padrão" fica selecionável (gerar e gerar novamente), com selos e aviso.
- **`plans/catalog.ts`**, **`subscription/strings.ts`** — benefício "Reescrita com IA para o seu público" no PRO; `ai_rewrite_enabled` e `ai_requests_per_day` a partir do PRO.

### Migration

- **`20261110120000_restrict_ai_rewrite_to_pro_max`** — preset LITE e tenants LITE com `ai_rewrite_enabled` = false.

---

## [app 0.93.0] — 2026-11-09 — Monitoramento: capturadas e fila recolhíveis

### Added

#### Frontend — componentes e monitoramento

- **`SectionCard.tsx`** — prop `collapseKey`: nasce recolhido, título vira botão (`aria-expanded`, chevron à direita), memória por navegador; a ação do cabeçalho segue clicável.
- **`CapturedOffersList.tsx`**, **`SendQueuePanel.tsx`** (prop `collapseKey`), **`MonitoringPage.tsx`** — Ofertas capturadas e Fila de envio nascem recolhidas no Monitoramento e lembram o estado; no gerador a fila segue aberta.

### Changed

- **`MonitorCard.tsx`** — cor do título do cabeçalho recolhível explícita (`text.primary`), não herdada do botão.

---

## [0.76.1] — 2026-11-09 — Encurtador shoope.top como link Shopee

### Fixed

#### Backend — gerador/monitoramento (campaigns)

- **`detectMarketplace.ts`**, **`HttpShortLinkExpander.ts`** — `shoope.top/…` caía em "Loja não suportada". É encurtador de **terceiro** (DivulgaLinks), não da Shopee, mas redireciona direto para `shopee.com.br/product/…`. Entra na allowlist da Shopee e em `SHORT_HOSTS`; como todo salto é revalidado, só vira oferta se o redirect cair em `shopee.com.br`.

#### Frontend (app 0.92.2)

- **`offerStore.ts`** — aviso "loja detectada" reconhece `shp.ee`, `shoope.top`, `a.co`, `link.amazon` e `amzlinks.in`, alinhado à API.

---

## [app 0.92.1] — 2026-11-09 — Formato da imagem: segmentos iguais

### Fixed

#### Frontend — gerador e monitoramento

- **`ImageModePicker.tsx`** — "Imagem com legenda" ficava espremida (3 linhas) porque o `<span>` do tooltip dentro do `ToggleButtonGroup` quebrava a largura igual e as bordas. Botão indisponível agora usa `aria-disabled` + classe `Mui-disabled` com `pointerEvents` ligado (tooltip sem invólucro, `describeChild`); segmentos `flex: 1 1 0`, 44 px de altura, rótulo em uma linha e ícone oculto em `xs`.

---

## [0.76.0] — 2026-11-09 — Monitoramento: padrões novos, recursos por plano e prévia do link

### Added

#### Backend — planos (tenants) e monitoramento (automation)

- **`entitlementKeys.ts`**, **`planPresets.ts`**, **`subscriptionLimits.ts`** — entitlements `enrich_link_only_enabled` (LITE false, PRO/MAX true) e `capture_outside_window_enabled` (só MAX); ausente = bloqueado.
- **`RegisterCapturedMessageUseCase.ts`** — fora da janela só captura com `captureOutsideWindow` **e** o entitlement do MAX (lido só nesse caso); `SaveGroupMonitorSettingsUseCase` grava `false` sem o plano, `limits.captureOutsideWindowEnabled` no GET.
- **`GroupMonitorConfigUseCases.ts`** — `limits.enrichLinkOnlyEnabled` no GET; salvar com `enrichLinkOnly` sem o plano → `PLAN_FEATURE_UNAVAILABLE`.
- **`ProcessPendingCapturedOffersUseCase.ts`** — captura só com link só vira oferta montada com o entitlement; plano rebaixado cai no texto original.
- **`OfferImageMode.ts`** — `MEDIA_IMAGE_MODE_ENABLED = false` e `effectiveImageMode`: "Imagem com legenda" desligada para todos os planos até nova decisão; `MEDIA` salvo sai como `LINK_PREVIEW` (envio, PATCH da oferta, config e captura do monitoramento).

#### Frontend — monitoramento e gerador (app 0.92.0)

- **`MonitorCard.tsx`** — prop `collapseKey`: card nasce recolhido, cabeçalho vira botão (`aria-expanded`), lembra aberto/fechado por navegador. Usado em Horário de postagem, Envio, Depois da captura e Texto da oferta.
- **`MonitoringSettingsForm.tsx`**, **`settingsDraft.ts`** — switch "Montar a oferta quando chegar só o link" travado fora do PRO/MAX (conta como desligado no salvar e no "não salvo").
- **`ImageModePicker.tsx`**, **`offerConfig.ts`**, **`OfferChatPreview.tsx`** — "Imagem com legenda" desabilitada com tooltip; padrão e valor efetivo = prévia do link.
- **`PlanAvailabilityBadges.tsx`**, **`ToggleOption.tsx`** (prop `badge`) — selos dos planos que incluem a opção (PRO MAX / MAX) ao lado de "Montar a oferta quando chegar só o link" e "Capturar fora do horário"; esta travada fora do MAX.
- **`subscription/strings.ts`**, **`plans/catalog.ts`** — linhas e benefícios "Oferta montada a partir só do link" (a partir do PRO) e "Captura fora do horário de postagem" (exclusivo MAX).

### Changed

- **`monitorSettings.ts`**, **`schema.prisma`** — padrões do monitoramento: intervalo 0–0, "digitando…" ligado 3 s, validade 24 h com e sem cupom, `enrichLinkOnly` false, `imageMode` `LINK_PREVIEW`; `Offer.imageMode` padrão `LINK_PREVIEW`. Só o DEFAULT muda: configurações salvas ficam como estão.

### Migration

- **`20261110000000_monitor_defaults_and_plan_gated_features`** — `ALTER COLUMN … SET DEFAULT` em `group_monitor_configs`/`offers`, presets do entitlement novo e backfill em `tenant_entitlements` (`ON CONFLICT DO NOTHING`). Roda no boot da Render.

---

## [0.75.1] — 2026-11-09 — Links link.amazon e contadores da fila

### Fixed

#### Backend — gerador/monitoramento (campaigns)

- **`detectMarketplace.ts`**, **`HttpShortLinkExpander.ts`** — `link.amazon/…` (encurtador atual da Amazon, salta por `amzlinks.in` até `amazon.com.br`) caía em "Loja não suportada": hosts fora da allowlist. Entraram `link.amazon` e `amzlinks.in`. O host responde 404 ao HEAD, então o expansor repete com GET em qualquer status ≥ 400 (antes só 405/501).
- **`GetSendQueueUseCase.ts`**, **`sendQueue.schema.ts`** — `counts.cancelledToday` (aditivo): cancelados do dia já eram contados no banco e descartados.

#### Frontend — fila de envio (app 0.91.1)

- **`SendQueuePanel.tsx`**, **`sendQueue/strings.ts`** — abas mostravam sempre "Aguardando (100)" e "Concluídos hoje (20)": usavam o tamanho da lista, que a API corta em 100/20. Agora usam os contadores exatos; "Mostrar os N próximos de TOTAL" quando a lista veio cortada.

---

## [0.75.0] — 2026-11-09 — Dashboard de consumo (séries e valores atuais)

### Added

#### Backend — leitura do dashboard de consumo (metrics)

- **`metrics/presentation/routes/opsMetrics.routes.ts`** — `GET /admin/ops/metrics/series` (baldes avg/min/max no servidor, até 12 métricas, janela ≤ 7 dias) e `GET /admin/ops/metrics/latest` (último valor 15 min, limiares dos alertas, top consultas, `samplerActive`, workers vivos); só super admin, sem chamar a Render.
- **`GetOpsMetricsSeriesUseCase.ts`**, **`GetOpsMetricsLatestUseCase.ts`** — validação de nomes contra `OPS_METRIC`, agrupamento por série e `kind` derivado.
- **`domain/services/opsMetricsSeriesPolicy.ts`** — `opsBucketMinutes` (5…360 min, ≤ 240 pontos) e `opsResourceKind` (api/postgres/worker/query/other), puras.
- **`PrismaOpsMetricsSampleRepository.ts`** — `aggregate`, `latestSince`, `latestStatementSnapshot` (SQL cru com `statement_timeout` 2 s; corte e balde em UTC independentes do `TimeZone` da sessão), contrato `IOpsMetricsSeriesReader`.
- **`opsMetrics.schema.ts`**, **`opsMetricsPresenter.ts`** — schemas de resposta fechados e presenters; `presentWorker` compartilhado.

### Changed

- **`ListOpsMetricsUseCase.ts`** — regra da janela extraída para `resolveOpsMetricsWindow` (reuso, sem mudança de contrato).

### Fixed

#### Backend — leitura do dashboard de consumo (metrics)

- **`PrismaOpsMetricsSampleRepository.ts`** (`aggregate`) — min/max de gauge vinham de `value` (média de 5 min) e escondiam picos; agora `meta.min`/`meta.max` com guarda `jsonb_typeof = 'number'` (senão `value`). Counters (`OPS_COUNTER_METRICS` em `OpsMetric.ts`) seguem em `value`.
- **`PrismaOpsMetricsSampleRepository.ts`**, **`GetOpsMetricsSeriesUseCase.ts`**, **`opsMetricsSeriesPolicy.ts`** — `/series` sem teto: `db_statement_total_ms` sem `resource` gerava uma série por `queryid`. Teto no SQL: top 10 `queryid` por `max(value)` na janela e no máximo 40 séries por resposta (`OPS_SERIES_MAX_STATEMENT_SERIES`, `OPS_SERIES_MAX_SERIES`; campos `maxStatementSeries`/`maxSeries` em `OpsMetricsSeriesFilter`).
- **`PrismaOpsMetricsSampleRepository.ts`** (`latestStatementSnapshot`) — rodava sem `statement_timeout`; agora uma consulta só em `$transaction` com `SET LOCAL statement_timeout = '2s'`, como as demais leituras.

## [0.74.0] — 2026-11-09 — Filas independentes, gate do chat e métricas de recursos

Tudo atrás de flags desligadas por padrão. Gates de produção de A, B e C seguem **pendentes**
(benchmark só sintético). Plano e revisões: `.specs/features/monitoring-queue-isolation/`.

### Added

#### Backend — fila de ofertas (campaigns, automation)

- **`campaigns/infrastructure/worker/OfferDispatchWorker.ts`**, **`app/offerWorkerComposition.ts`** — captura e envio em slots independentes no mesmo timer de 2 s (`OFFER_WORKER_INDEPENDENT_STAGES_ENABLED`); `stop()` sinaliza as duas etapas e espera sob o orçamento de shutdown. Antes, um envio lento (digitação, timeout de 60 s) segurava a preparação de capturas de todos os tenants. Benchmark sintético: espera p95 da captura 98,6 s → 29,0 s.
- **`ProcessPendingCapturedOffersUseCase.ts`**, **`ProcessDueOfferDispatchesUseCase.ts`** — contexto cooperativo (`AbortSignal`) e logs de observação por item (idade, duração, atraso), sem texto, link ou credencial.
- **`campaigns/application/services/ConcurrentOfferDispatchExecutor.ts`** — até 2 envios simultâneos entre sessões distintas (`OFFER_DISPATCH_CONCURRENCY`, 1–2; 2 exige etapas independentes). Vaga presa à promise original do sender; sessão excluída do claim até o settle.
- **`automation/infrastructure/repositories/PrismaCapturedOfferRepository.ts`** — claim justo de capturas pelo tenant menos atendido (`MONITORING_FAIR_CLAIM_ENABLED`), turno persistido via sequência, `SKIP LOCKED` e `lock_timeout`.

#### Backend — chat por entitlement (chat, messaging)

- **`chat/infrastructure/entitlement/CachedChatEntitlementGate.ts`**, **`messaging/infrastructure/ingestGate/`** — com `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED`, tenant sem `chat_enabled` grava só o contato 1:1, não grava conversa/mensagem/histórico e só baixa imagem de grupo monitorado (`IIncomingMediaPolicy` nos adapters Baileys e Telegram). Ver `docs/chat-ingestao-por-entitlement.md`.

#### Backend — métricas de recursos (metrics, sessions)

- **`sessions/infrastructure/jobs/WorkerHeartbeatJob.ts`** — grava CPU do Node e p99 do event loop.
- **`metrics/`** — `OpsMetricsSamplerJob` (60 s, só worker, dono único por lease): Render Metrics API, `pg_stat_*` com `statement_timeout`, persistência a cada 5 min em `ops_metrics_samples` (7 dias), alertas só em log. `GET /admin/ops/metrics` só super admin. Ver `docs/ops-metricas.md`.

### Changed

- **`shared/events/InternalMessagingEvent.ts`** — `MESSAGE_RECEIVED` ganha `authorLid?` (dígitos). Emissor: `BaileysMessagingEngineAdapter`; consumidor: `ChatIncomingMessageListener` → `IngestIncomingMessageUseCase` (grava `chat_contacts.lid` só no 1:1). Telegram não emite; engine remota não transporta eventos.
- **`BaileysMessagingEngineAdapter.ts`** — menções e autor de citação consultam o par LID↔telefone no banco (com prazo) antes da engine; eco da própria mensagem é pulado no `notify` antes do download (vale também com flag desligada: era download descartado pelo dedup).
- **`PrismaOfferDispatchRepository.ts`** — `claimDue` aceita exclusão de sessões; lista vazia = SQL idêntico ao anterior.

### Migrations

- `20261109100000_add_worker_heartbeat_resources` — `worker_heartbeats.cpuPct`/`eventLoopP99Ms` nullable.
- `20261109110000_create_ops_metrics_samples`, `20261109110500_add_ops_metrics_samples_at_index` — tabela nova sem tenant.
- `20261109120000_add_chat_contact_lid` — `chat_contacts.lid` nullable + índice `(tenantId, lid)`, sem backfill.
- `20261109130000_add_monitoring_claim_turn` — `tenants.monitoringClaimTurn` + sequência, sem backfill.
- Todas aditivas, seguras para deploy sobreposto com imagem antiga. Sem `lock_timeout` na migration: falha registraria a migration como falha (P3009) e travaria o boot; tabelas afetadas são pequenas (chat_contacts ~55 mil linhas).

## [0.73.3] — 2026-11-08 — Plano de isolamento das filas

### Documentation

- **`.specs/features/monitoring-queue-isolation/`** — requisitos, desenho, tarefas, gates de recursos e revisão do plano de independência de captura/envio; concorrência e justiça por tenant condicionadas à medição. Sem alteração de código operacional, migration aplicada ou ativação de flags.
- **`.specs/codebase/TESTING.md`** — corrige matriz desatualizada: integração Postgres/Redis local já existe e exige execução serial; SQL/claims devem ter testes de integração.

## [0.73.2] — 2026-11-08 — plano DEV no fluxo de assinatura

### Fixed

- **`tenants/domain/planPresets.ts`** — mapeia `afiliado-dev-anual` e `copysync-dev-anual` para `COPYSYNC_MAX`, de acordo com a configuração do plano DEV no Hub; ativação, renovação e reconciliação usam os limites existentes. Testes cobrem provisionamento, reentrega idempotente e aliases desconhecidos. Sem migration ou alteração de dados.

## [0.24.0] — 2026-10-27 — Extension Bridge API (F1)

### Added

#### Backend — Módulo Extension (sessão por cookie, ciclo de vida, outbox)

- **`extension/domain/`** — Entidades ExtensionSession, ExtensionInstallation; contratos IExtensionSessionRepository, IExtensionInstallationRepository, IExtensionEntitlementReader; constantes de TTL
- **`extension/infrastructure/`** — PrismaExtensionSessionMapper, PrismaExtensionInstallationMapper, PrismaExtensionSessionRepository, PrismaExtensionInstallationRepository, extensionContainer (lazy singleton)
- **`extension/application/use-cases/`** — IssueExtensionSessionUseCase, ValidateExtensionSessionUseCase, RevokeExtensionSessionUseCase, GetExtensionProfileUseCase, RecordLifecycleSignalUseCase
- **`extension/presentation/`** — extensionAuthHook (cookie → sha256 → lookup), extensionRequestGuard (X-Client, X-Installation-Id, Origin), cookieHelper (parse/set/clear sem @fastify/cookie)
- **`extension/presentation/routes/extension.routes.ts`** — POST /session (Bearer), DELETE /session (cookie), GET /me (cookie), POST /heartbeat (cookie), GET /sessions (Bearer), DELETE /sessions/:id (Bearer), POST /lifecycle/event (público), POST /lifecycle/uninstall (público)

#### Backend — Infraestrutura

- **`shared/http/rateLimitPresets.ts`** — Presets de rate limiting (lifecycle, extensionAuth, extensionSync, general)
- **`@fastify/rate-limit@^9`** — Rate limiting global (120 req/min por IP)
- **Migration `20261027120000_add_extension_sessions_lifecycle_outbox`** — Tabelas extension_installations, extension_sessions, extension_lifecycle_events, hub_outbox_events, hub_outbox_sequences; enum ExtensionInstallationStatus, HubOutboxEventStatus; novos campos em affiliate_credentials; preset marketplace_extension nos 3 planos

#### Backend — Entitlements

- **`tenants/domain/contracts/IEntitlementReader.ts`** — Movido de campaigns (re-export mantido)
- **`tenants/infrastructure/repositories/PrismaEntitlementReader.ts`** — Movido de campaigns (re-export mantido)
- **`shared/errors/internal/PlanErrors.ts`** — PlanFeatureUnavailableError genérico

### Changed

- **`shared/config/env.ts`** — CORS_ORIGIN default '' (era '*'); novas vars EXTENSION_ORIGINS, HUB_EVENTS_*, ML_ACCOUNT_HMAC_KEYS; validação de produção; transforms PANEL_ORIGIN, EXTENSION_ORIGINS_LIST, HUB_EVENTS_CONFIGURED
- **`app/app.ts`** — CORS fail-closed (sem wildcard), trustProxy 1, credentials:true, allowedHeaders += x-client/x-installation-id; Swagger CopySync API; removidas URLs waioprime
- **`integrations/application/dtos/AffiliateCredentialDTO.ts`** — AffiliateSessionSecret: `{cookies, csrf?}` (era `{sessionToken, csrfToken}`)
- **`integrations/application/use-cases/UpsertAffiliateSessionUseCase.ts`** — Formato cookies; compara ssid para detectar mudança
- **`integrations/application/use-cases/ResolveAffiliateCredentialUseCase.ts`** — parseSession aceita formato legado e novo
- **`campaigns/domain/contracts/IAffiliateCredentialResolver.ts`** — session type `{cookies}` (era `{sessionToken}`)
- **`campaigns/domain/contracts/IProductPageReader.ts`** — mercadoLivreCookies (era mercadoLivreSessionToken)
- **`campaigns/infrastructure/http/HttpProductPageReader.ts`** — Lê ssid do mapa de cookies

### Fixed

- **`integrations/billing/SyncTenantEntitlementsUseCase.ts`** — planSlug atualizado mesmo sem presets; `preset.value ?? 'false'` para booleanas
- **`integrations/billing/ApplyBillingEventUseCase.ts`** — `preset.value ?? 'false'` (era `?? undefined`)

### Breaking Changes

- **AffiliateSessionSecret** mudou de `{sessionToken, csrfToken}` para `{cookies: Record<string,string>, csrf?: string}`. parseSession aceita ambos formatos na leitura.
- **IProductPageReader** campo `mercadoLivreSessionToken` → `mercadoLivreCookies: Record<string,string>`
- **CORS** não aceita mais wildcard `*` em produção; CORS_ORIGIN deve ser explícito

---

## [0.75.0] — 2026-11-09 — Dashboard de consumo (séries e valores atuais)

### Fixed — app 0.82.1 — Conferência visual e testes estáveis

- **`app/AppLayout.tsx`, `pages/DashboardPage.tsx`** — seletor de tema no cabeçalho mobile; tenant e sessões do dashboard borram pelas flags de privacidade; chip do tenant com largura máxima; botão "Gerenciar" não vaza a 375 px.
- **`components/PostingWindowField.tsx`, `ConfigConfirmStep.tsx`, `SessionStatusChip.tsx`, `AdminWorkersPage.tsx`** — contraste dos dias, ícone ao lado do resumo do horário, rótulo de capacidade sem corte, coluna do worker com largura mínima.
- **`OfferGeneratorForm.tsx`, `SettingsLayout.tsx`, `AiSettingsPage.tsx`** — ícone de brilhinhos trocado (regra sem sparkles).
- **Testes do painel** — corrida real em `MonitoringPage.test.tsx`; `waitFor` do Testing Library; relógio real restaurado no `afterEach`; prazos de teste maiores sob carga.
- **API (testes)** — testes de integração só-Redis rodam sem banco; Redis descartável com nome único por porta.

### Changed — api 0.64.0 · app 0.82.0 — Só login concluído ocupa vaga do worker (E4 T24)

- **`CapacityLimitedLeaseGate.ts`, `ISessionSocketControl.ts`, adapters Baileys/Telegram, `sessionLeaseContainer.ts`, `AdoptNextSessionUseCase.ts`, `WorkerHeartbeatJob.ts`** — decisão do dono: sessão em QR/pareamento/código/senha não ocupa vaga de `WORKER_MAX_SESSIONS`; teto próprio `WORKER_MAX_PENDING_LOGINS` (padrão 50); login concluído com o worker cheio fica; adoção para com autenticadas ≥ teto. Sem efeito com `WORKER_ADOPTION_ENABLED=false`.
- **Migration `20261105120000_add_worker_heartbeat_pending_logins`** — coluna aditiva `worker_heartbeats.pendingLogins`.
- **`/admin/workers`, `AdminWorkersPage.tsx`** — coluna "Aguardando login".

### Fixed — api 0.63.0 · app 0.81.0 — Correções das revisões independentes (E3, E4, Assinatura, disparo)

#### Backend

- **`remote/transport/BullEngineCommandQueues.ts`, `shared/errors/internal/MessagingErrors.ts`** — comando com job já ativo no timeout devolve `ENGINE_COMMAND_OUTCOME_UNKNOWN` (504) em vez de `ENGINE_NOT_READY` (reenvio manual duplicava); `maxStalledCount: 0`; ready+add dentro do prazo; close do worker com teto de 20 s.
- **`app/server.ts`, `shared/config/env.ts`, `app/roleComposition.ts`** — falha de boot encerra o processo; `http`/`worker` exigem S3 completo; relay do `http` sobe em background (porta antes do Redis), `/health` com `relay`.
- **`remote/transport/RedisEngineRpc.ts`, `remote/outboundMediaTransfer.ts`** — RPC com `deadline` (pedido vencido não executa); varredura de `outbound-tmp/` (> 1 h).
- **`sessions/application/use-cases/AdoptNextSessionUseCase.ts`, `CapacityLimitedLeaseGate.ts`, `PrismaSessionAdoptionRepository.ts`** — adoção abre como automática e devolve vaga/contador ao perder (`revertAdoptAttempt`); reserva síncrona de vaga no teto; Telegram em `AWAITING_CODE/PASSWORD` fora da adoção; `/admin/workers` sem consulta com a flag desligada; `PrismaJobLease` em `shared/infrastructure/jobs/`.
- **`integrations/billing/billing.routes.ts`, `parseExpiresAt.ts`** — `expiresAt` malformado → 400 `invalid_expires_at` (antes virava "sem vencimento").
- **`campaigns/domain/services/postingWindow.ts`, `PrismaOfferDispatchRepository.ts`** — janela com início 24:00 normalizada (regra e SQL iguais); claim com fuso fixo `America/Sao_Paulo`.
- **`automation/.../GroupMonitorConfigUseCases.ts`, `PrismaGroupMonitorRepository.ts`** — grupo de disparo preso a sessão apagada não bloqueia outro monitoramento.

#### Frontend

- **`features/chat/media/*`** — envio com resultado desconhecido não oferece "Tentar de novo".
- **`pages/settings/SubscriptionPage.tsx`, `SubscriptionPlanCard.tsx`** — troca de tenant mostra skeleton; CTA só para ADMIN confirmado.
- **`features/offers/components/config/*`** — resumo do horário no Confirmar; catálogo de grupos buscado uma vez; assistente valida limite pela união; foto do grupo e da sessão borram.

### Added — app 0.80.0 — Tema sistema/claro/escuro e ajustes do painel

#### app

- **`contexts/ThemeContext.tsx`, `contexts/themePreference.ts`, `components/ThemeModeSelector.tsx`** — tema com três opções (sistema, claro, escuro; padrão sistema, segue `prefers-color-scheme` e reage à mudança). Preferência na mesma chave `colorMode` (valores antigos respeitados); um seletor substitui os quatro toggles (layout, login, convite, páginas públicas).
- **`app/AppLayout.tsx`, `features/privacy/privacyFlags.ts`** — nome do tenant no cabeçalho, na topbar e no menu de troca borra com a flag `layout.tenantName`.
- **`theme/theme.ts`** — `ptBR` do MUI no tema: textos padrão (ex.: "Fechar" do Alert) em pt-BR.
- **`features/offers/components/AudiencePicker.tsx`** — cards de público-alvo não cortam a 1280 px (grade pela largura do formulário, reticências + Tooltip).
- **Assinatura, disparo, E3:** `features/chat/media/*` — envio com resultado desconhecido (`ENGINE_COMMAND_OUTCOME_UNKNOWN`) não oferece "Tentar de novo".

### Added

#### Separação HTTP × worker (`messaging`, `sessions`, `chat`, escala E3) e adoção por capacidade (escala E4) — api 0.62.0 · app 0.79.0

Doc: `docs/arquitetura-escala.md` §3.2, §3.3, §5.1, §6. Com HTTP e sockets em processos diferentes rotas, WS e suspensão de tenant não funcionavam, e sessão órfã só voltava com clique do usuário, sem teto por processo. Defaults (`PROCESS_ROLE=all`, `WORKER_ADOPTION_ENABLED=false`) = comportamento anterior (smokes com log idêntico). Breaking: nenhum. Migration: sim (`worker_heartbeats`). Pendências: smoke com sessão real, timeout do comando de texto (60 s), vaga presa por QR sem leitura.

- **`env.ts`** + **`processRole.ts`** — `PROCESS_ROLE` (`http|worker|all`), `REDIS_URL`, `ENGINE_COMMAND_CONCURRENCY` (2); `http`/`worker` exigem Redis e `MEDIA_STORAGE_DRIVER=s3`; `all` nunca abre Redis
- **`localEngineContainer.ts`** + **`roleComposition.ts`** + **`session.routes.ts`** — engine montada fora das rotas; rotas leem `getActiveEngine()` (remota no `http`, sem Baileys/GramJS)
- **`redisConnections.ts`** + **`scripts/redis-descartavel.sh`** — ioredis/BullMQ lazy, fechados no shutdown
- **`engineCallPlan.ts`** + **`engineCallCodec.ts`** + **`engineErrorWire.ts`** + **`ports.ts`** — método → local/rpc/command/open; erro interno atravessa como `{code,message,meta}`
- **`RedisEngineRpc.ts`** + **`BullEngineCommandQueues.ts`** — RPC 10 s; filas `engine-cmd-{workerId}` e `session-open`, sem retry
- **`EngineCommandServer.ts`** + **`RemoteMessagingEngineAdapter.ts`** + **`outboundMediaTransfer.ts`** — worker valida posse e solta lease após disconnect/logout; `http` resolve o dono pelo lease; mídia por objeto temporário
- **`createOutboundMessageId`** async nos chamadores — id do Baileys exige o socket do dono
- **`RedisChatEventRelay.ts`** — WS entre processos por `tenant:{id}`; SSE `GET /chat/events` removido
- **`FailOrphanPendingMediaUseCase.ts`** — boot poupa mídia de sessão com lease vivo de outro processo
- **`processJobs.ts`** + **`workerApp.ts`** + **`server.ts`** — jobs, boot e shutdown por papel; worker só com `/health`; `/health` com `role`
- **`workerAdoption.ts`** + **`sessionAdoptionPolicy.ts`** — `WORKER_ADOPTION_ENABLED`, `WORKER_MAX_SESSIONS` (40), `WORKER_SHARD`; tick 5 s, backoff até 30 min, 5 tentativas, heartbeat 20 s, alerta > 80 %
- **Migration `20261104160000_create_worker_heartbeats`** + **`PrismaWorkerHeartbeatRepository.ts`** — ocupação por processo
- **`PrismaSessionAdoptionRepository.ts`** — adoção `FOR UPDATE SKIP LOCKED` (inclui `AWAITING_*` órfã), tentativa contada na adoção, esgotadas → `FAILED` auditado
- **`CapacityLimitedLeaseGate.ts`** — teto no gate do lease (rota, `session-open`, bootstrap, ticker); cheio → 503
- **`AdoptNextSessionUseCase.ts`** + **`SessionAdoptionTicker.ts`** + **`sessionAdoptionContainer.ts`** — readoção; com a flag o bootstrap vira ticker
- **`markConnectRequested.ts`** + listener de `SESSION_CONNECTED` — zeram o backoff
- **`WorkerHeartbeatJob.ts`** + **`WorkerCapacityAlertJob.ts`** + **`shared/jobs/PrismaJobLease.ts`** — heartbeat e alerta sob `JobLease` (só log; e-mail adiado)
- **`GET /admin/workers`** + **`awaitingCapacity`** no item de sessão — super-admin vê ocupação; sessão sem vaga sinalizada
- **`server.ts`** — shutdown com adoção: ticker/heartbeat → jobs → mídia com teto → sockets → flush → leases → heartbeat apagado
- **app `useChatSSE.ts`** (removido), **`SessionStatusChip.tsx`** + **`sessions/strings.ts`** (chip "Aguardando capacidade"), **`workersAdmin/`** (página `/admin/workers`)
- **Docs** — `arquitetura-escala.md` (fases 3/4, envs, checklist multi-processo, o que não fazer), `plano-lancamento-hub-copysync.md` (trilha E), `sessoes-conexao.md`, linha no `AGENTS.md`

#### Grupos de disparo e horário de postagem (`campaigns`, `automation`, app `broadcastGroups`/`offers`/`monitoring`) — api 0.61.0 · app 0.78.0

Doc: `docs/grupos-de-disparo-e-horario.md`. O limite de grupos de disparo era contado separado no gerador e em cada monitoramento (LITE chegava a 10 com limite 5), não havia tela única dos grupos e o horário não tinha dias da semana nem valia para o gerador. Breaking: nenhum. Migration: sim.

- **`broadcastGroupUnion.ts`** + **`IBroadcastGroupUsageReader.ts`** + **`PrismaBroadcastGroupUsageReader.ts`** — união `offer_destinations` ∪ `broadcast_groups` por sessão + JID, `tenantId` em toda consulta
- **`OfferGeneratorConfigUseCases.ts`** + **`GroupMonitorConfigUseCases.ts`** — limite `broadcast_groups`/`telegram_broadcast_groups` e `usage` pela união; envio intocado. **Deploy:** tenant já acima do limite pela soma não salva novos destinos até remover grupos
- **`ListBroadcastGroupsUseCase.ts`** + **`RemoveBroadcastGroupUseCase.ts`** + **`IBroadcastGroupRemover.ts`** + **`broadcastGroups.routes.ts`** — `GET /campaigns/broadcast-groups` (catálogo com `usedBy`) e `DELETE /:conversationId` (remove de todos os usos, transação, idempotente)
- **Migration `20261104180000_add_posting_schedule_weekdays`** — `group_monitor_configs.weekdaysMask` (127) e `offer_generator_configs.windowStartMinute`/`windowEndMinute`/`weekdaysMask` (0/1440/127); só ADD COLUMN DEFAULT
- **`postingWindow.ts`** + **`operatingWindow.ts`** — regra pura com dias da semana (madrugada = dia do início, até 7 dias, mask 0 inválido)
- **`PrismaOfferDispatchRepository.ts`** — claim respeita dia da semana do monitoramento e janela do gerador; `scheduledAt` explícito ignora a janela
- **`groupMonitoring.schema.ts`** + **`monitorSettings.ts`** + **`PrismaGroupMonitorMapper.ts`** + **`RegisterCapturedMessageUseCase.ts`** + **`ProcessPendingCapturedOffersUseCase.ts`** — `weekdays` no monitoramento (contrato e coluna juntos), captura e `fitSlot` usam o dia
- **`fitSlots.ts`** + **`offer.schema.ts`** + **`PrismaOfferGeneratorConfigRepository.ts`** + **`SendOfferUseCase.ts`** + **`OfferSendControlUseCases.ts`** — horário do gerador na config; disparo e retomada sem `scheduledAt` encaixam na janela
- **app `broadcastGroups.service.ts`** + **`useBroadcastGroups.ts`** + **`BroadcastGroupsTable.tsx`** + **`BroadcastGroupsPage.tsx`** + **`AppRoutes.tsx`** + **`navigation/model.ts`** — página `/broadcast-groups` com filtro persistido, remoção com confirmação e item no menu Afiliados
- **app `broadcastGroups/strings.ts`** + **`privacyFlags.ts`** — textos e flags `broadcastGroups.groupNames`/`groupAvatars`/`sessionName`
- **app `ChannelCounterChips.tsx`** + **`GroupUsageChip.tsx`** — tooltip "o limite soma gerador e monitoramento"
- **app `PostingWindowField.tsx`** + **`postingWindowStrings.ts`** — slider + dias da semana; usado em **`MonitoringSettingsForm.tsx`** (rascunho v6, `OperatingWindowField` removido) e no passo **`ConfigScheduleStep.tsx`** do **`OfferConfigWizard.tsx`** (rascunho v2)
- **Docs** — `docs/grupos-de-disparo-e-horario.md`, linha no `AGENTS.md`, roadmap itens 5 e 6 ✅, `fila-de-envio.md` §2.6, `monitoramento-grupos.md` §2.2/§3, `gerador-de-ofertas.md`

#### Tela Assinatura (`tenants`, `billing`, `auth`, app `subscription`) — api 0.60.0 · app 0.77.0

Doc: `docs/assinatura.md`. O tenant não tinha onde ver plano, status, vencimento e uso × limite, e o suspenso ficava preso no `TENANT_SUSPENDED` sem acesso ao motivo.

- **Migration `20261105001005_add_tenant_subscription_expires_at`** + **`Tenant.ts`** + **`PrismaTenantMapper.ts`** — `subscriptionExpiresAt` (nulo = vencimento desconhecido)
- **`ApplyBillingEventUseCase.ts`** + **`billing.routes.ts`** — receiver grava `expiresAt` em `activated`/`renewed`/`updated` (ISO inválido → `null`); demais eventos preservam
- **`resolveMembership.ts`** + **`tenantAnyStatusHook.ts`** — `allowInactive`; hook só para `GET /subscription` (não-membro segue 403)
- **`subscriptionLimits.ts`** — itens exibidos a partir de `ENTITLEMENT_KEYS` (regras de ausente; chave nova sem linha falha o teste)
- **`ITenantUsageReader.ts`** + **`PrismaTenantUsageReader.ts`** — uso por canal com `tenantId` em toda consulta
- **`IEntitlementSnapshotReader.ts`** + **`PrismaEntitlementReader.ts`** — leitura em lote (1 `findMany`)
- **`GetTenantSubscriptionUseCase.ts`** + **`TenantSubscriptionDto.ts`** — tenant + entitlements + uso em paralelo; 404 sem tenant
- **`subscription.routes.ts`** + **`SubscriptionPresenter.ts`** + **`routes.ts`** — `GET /subscription`; slug `COPYSYNC_LITE/PRO/MAX` → `starter/profissional/business`
- **app `subscription.service.ts`** + **`api.types.ts`** — `getSubscription()` e `SubscriptionResponse`
- **app `features/plans/checkout.ts`** + **`.env.example`** — `buildCheckoutUrl` (`VITE_BILLING_CHECKOUT_URL`, repassa `utm_*`/`gclid`/`fbclid`; sem env → `null`)
- **app `features/subscription/`** (`strings.ts`, `SubscriptionPlanCard.tsx`, `SubscriptionLimitsTable.tsx`, `usageTone.ts`) + **`privacyFlags.ts`** — card do plano (CTA só ADMIN), tabela de limites por canal, flag `subscription.tenantName`
- **app `SubscriptionPage.tsx`** + **`AppRoutes.tsx`** + **`SettingsLayout.tsx`** — rota `/settings/subscription` em Configurações
- **app `apiClient.ts`** — `TENANT_SUSPENDED` redireciona uma vez para `/settings/subscription?suspended=1` (sem loop, sem limpar sessão)
- **Docs** — `docs/assinatura.md`, linha no `AGENTS.md`, `arquitetura-central-billing.md` (linha "Painel") e `navegacao-produtos.md` (Assinatura, Grupos de disparo, Workers)

#### Lease de sessão e CAS no auth state (`sessions`, `messaging`, escala E2) — api 0.59.0

- **Migration `20261104150000_add_session_lease`** — `ownerWorkerId`, `leaseUntil`, `connectRequestedAt`, `nextAdoptAt`, `adoptFailures`, `shard` em `sessions` (só ADD COLUMN; backfill de `connectRequestedAt` nas `CONNECTED`)
- **`sessionLeasePolicy.ts`**, **`workerIdentity.ts`**, **`env.ts`** (`WORKER_ID` opcional) — TTL 60 s, renovação 20 s, fence 55 s; id do processo único por boot
- **`PrismaSessionLeaseRepository.ts`**, **`SessionLeaseLedger.ts`**, **`Acquire/Renew/ReleaseSessionLeaseUseCase.ts`**, **`SessionLeaseKeeper.ts`**, **`sessionLeaseContainer.ts`** — um dono por sessão; lease perdido ou fence vencido derruba o socket sem gravar
- **`ISessionSocketControl.ts`**, **`BaileysMessagingEngineAdapter.ts`**, **`TelegramMessagingEngineAdapter.ts`**, **`MessagingEngineRouter.ts`** — `abortSession`/`closeAllSockets`/`listLocalSessionIds`; socket só abre com lease (`SessionLeaseHeldError` → 503)
- **`PrismaSessionAuthStateRepository.ts`**, **`BaileysAuthStatePersistence.ts`** — CAS por `version` em `writeKeys`; conflito descarta e derruba o socket
- **`markConnectRequested.ts`** — grava `connectRequestedAt` em connect, reconnect, pairing-code e login Telegram
- **`Disconnect/Logout/DeleteSessionUseCase.ts`**, **`TenantSuspendedSessionListener.ts`** — limpam `connectRequestedAt` com o status antes da engine e soltam o lease depois
- **`Connect/ReconnectSessionUseCase.ts`**, **`RequestSessionPairingCodeUseCase.ts`**, **`SessionLoginByCodeUseCases.ts`** — lease de outro processo restaura o status anterior e devolve 503
- **`SessionStatusReconciler.ts`**, **`SessionBootstrapService.ts`** — boot só toca sessões sem lease vivo; lease de outro processo é pulado sem gravar (readoção na E4)
- **`server.ts`** — keeper no boot; shutdown: keeper → jobs → drain de mídia → `closeAllSockets` → flush → `releaseAllOwned` → `app.close()`

#### Limite diário do gerador de ofertas por plano (`tenants`, `billing`, `campaigns`) — api 0.58.0

- **`planPresets.ts`** — `offer_generations_per_day`: LITE 5, PRO 20, MAX `null` (ilimitado explícito); tipo aceita `null` (só chave numérica)
- **`entitlementJsonValue.ts`**, **`ApplyBillingEventUseCase.ts`**, **`SyncTenantEntitlementsUseCase.ts`**, **`prisma/seed.ts`** — preset `null` grava `Prisma.JsonNull`; antes o `?? 'false'` virava string "false" e chave omitida fazia o upgrade PRO→MAX herdar o `20`
- **Migration `20261104140000_add_offer_generations_entitlement_presets`** — presets nos três planos + backfill dos tenants com plano (`DO NOTHING`)
- **Testes** — `planPresets.test.ts` trava 5/20/null; `ApplyBillingEventUseCase.test.ts` cobre upgrade PRO→MAX sobrescrevendo com JSON null

#### Frontend — Rodízio de links com limites por canal (`linkRotation`) — app 0.76.0

- **`channelLimits.ts`**, **`RotationChannelUsage.tsx`** — uso e limite de links por canal no cabeçalho ("WhatsApp 1/1 · Telegram 0/1"; "Telegram: a partir do PRO" no LITE); seletor de sessão trava canal sem vaga com motivo e "Ver planos"; limite de grupos por link segue o canal do rodízio; `PLAN_LIMIT_REACHED` das 4 chaves abre o upgrade certo

#### Rodízio de links com limites por canal (`link-rotation`, `tenants`, `plans`) — api 0.57.0 · app 0.75.0

- **`channelLimits.ts`**, **`planPresets.ts`** — `telegram_link_rotations` / `telegram_link_rotation_groups` (LITE 0/0, PRO 1/5, MAX 2/10); `link_rotations`/`link_rotation_groups` passam a ser do WhatsApp
- **Use cases do rodízio** — criar, reativar, trocar sessão de canal, salvar grupos e plano rebaixado contam e limitam pelo canal do rodízio; `GET /link-rotation` devolve `limits`/`usage` por canal
- **Migration `20261104130000_add_telegram_link_rotation_entitlement_presets`** — presets das chaves do rodízio nos três planos + backfill
- **Planos** — linha "Rodízio de links" por canal na tabela; destaque "Rodízio de links no Telegram" com o limite no PRO e no MAX

#### Grupos onde a sessão pode postar/convidar (`messaging`, `campaigns`, `automation`, `link-rotation`) — api 0.56.0 · app 0.74.0

- **`BaileysMessagingEngineAdapter.listParticipatingGroups`** — WhatsApp passa a marcar `canPost` (grupo só-admins e sessão não admin → `false`, `ADMINS_ONLY`) e `canInvite` (só admin), do metadado já buscado; destino sem permissão → `GROUP_NOT_POSTABLE` também no WhatsApp
- **`TelegramMessagingEngineAdapter.ts`** — `postBlockedReason` (`CHANNEL_READONLY`/`ADMINS_ONLY`), `inviteBlockedReason`, cache de 60 s na lista de dialogs
- **Configs do Monitoramento e do Gerador** — grupos salvos trazem `canPost`/`postBlockedReason` (lista ao vivo; sessão fora → `null`); lista do rodízio não filtra mais e traz `canInvite`
- **Painel** — `HideUnavailableSwitch` + `UnavailableReason` (`app/src/components`): "Ocultar grupos onde não posso postar" ligado por padrão no disparo do Monitoramento e no Gerador, "…gerar convite" no Rodízio (grupo sem convite entra com link manual); grupo salvo bloqueado ganha chip "Envio bloqueado" e alerta

#### Frontend — Cross Channel nos planos (`plans`) — app 0.73.0

- **`catalog.ts`**, **`PlanCard.tsx`** — bloco em destaque **Cross Channel** no MAX (monitorar no Telegram e postar no WhatsApp e vice-versa), ícone com os logos dos dois canais (`featureIcon`)

#### Frontend — Cross Session nos planos (`plans`) — app 0.72.0

- **`catalog.ts`**, **`PlanCard.tsx`** — recurso de monitorar em uma sessão e disparar em outra do mesmo canal passa a se chamar **Cross Session** (`CROSS_SESSION_NAME`); benefício com `featureName` vira bloco em destaque (moldura em gradiente, ícone, nome, chip Exclusivo) no MAX

#### Rodízio de links com Telegram (`link-rotation`, `messaging`) — api 0.55.0 · app 0.71.0

- **`link-rotation/domain/services/inviteUrl.ts`** — link de convite por canal (canal = engine da sessão do rodízio): WhatsApp `chat.whatsapp.com/<code>`; Telegram `t.me/+<code>`, `t.me/joinchat/<code>`, `t.me/<username>`. Antes um grupo Telegram geraria `chat.whatsapp.com/+…` quebrado
- **Capacidade por canal** — WhatsApp 50–1.024 (padrão 1.000), Telegram 50–200.000 (padrão 10.000; canal de transmissão não tem teto real)
- **`TelegramMessagingEngineAdapter.ts`** — `canInvite` na lista de grupos (rodízio filtra por ele), `GROUP_INVITE_NOT_ALLOWED` sem permissão de admin, contagem de membros de supergrupo/canal
- **Painel** — seletor de sessão e chips com foto, logo do canal e flag de privacidade `linkRotation.sessionAvatar`; link e ajuda no formato do canal

#### Frontend — Destaque do Telegram nos planos (`plans`) — app 0.70.0

- **`catalog.ts`**, **`PlanCard.tsx`** — benefício com `channel`: linha em destaque com logo e faixa na cor da marca. PRO e MAX ganham "Telegram: monitore e envie em grupos e canais". Corrige rolagem lateral no celular (`srOnly` da `ChannelLimitsTable` com `width: 1` = 100% no MUI)

#### Telegram — monitorar canais só inscritos (`messaging`, `campaigns`, `automation`) — api 0.54.0 · app 0.69.0

- **`TelegramMessagingEngineAdapter.listParticipatingGroups`** — lista todos os grupos e canais ativos com `canPost` (antes escondia canais sem permissão de postar, e o canal do concorrente não podia ser monitorado)
- **`EnsureSessionGroupUseCase`** — `purpose` `monitor` × `send`; destino sem permissão → `GROUP_NOT_POSTABLE` (422). Monitoramento usa `monitor` nos monitorados e `send` no disparo; rodízio de links filtra `canPost`
- **`GroupPickerDialog.tsx`**, **`ConfigGroupsStep.tsx`** — seletor de monitorados mostra tudo; disparo e gerador escondem onde não dá para postar

#### Frontend — Monitoramento e Gerador por canal (`monitoring`, `offers`) — app 0.68.0

- **`features/monitoring/utils/channelLimits.ts`**, **`GroupUsageChip.tsx`**, **`GroupPickerDialog.tsx`** — uso e limite de grupos monitorados e de disparo por canal ("WhatsApp 3/10 · Telegram 1/10"), bloqueio por canal no seletor, logo do canal nas sessões e chips "Envia por"; aviso de "marcar todos" sem efeito no Telegram; erro de limite por canal abre o aviso de upgrade certo
- **`ConfigSessionStep.tsx`**, **`ConfigGroupsStep.tsx`**, **`ChannelCounterChips.tsx`**, **`offerErrors.ts`** — gerador conta sessões e grupos por canal; sessão cruzada só avisa com 2+ sessões do mesmo canal
- **`ChannelLogo.tsx`**, **`DashboardPage.tsx`** — logo do canal reutilizável; dashboard com "Sessões" de ambos os canais

#### Frontend — Planos com limites por canal (`plans`) — app 0.67.0

- **`ChannelLimitsTable.tsx`**, **`catalog.ts`** — cartão de plano com tabela canal × sessões/monitorados/disparo (Telegram "A partir do PRO" no LITE); teste trava catálogo × presets da API; regra de sessão cruzada por canal no texto
- **`planUpsell.ts`** — tipos de upgrade para grupos monitorados e de disparo por canal

#### Backend — Monitoramento e gerador de ofertas pelo Telegram (`messaging`, `chat`, `campaigns`) — api 0.53.0

- **`engines/telegram/telegramMessageId.ts`** — id de mensagem `<peerId>_<msgId>` (o id do Telegram é único só por chat; colidia na captura e no dedupe do chat); citação, reação e leitura extraem o msgId
- **`engines/telegram/whatsappToTelegramHtml.ts`** — texto de oferta (sintaxe WhatsApp) vira HTML do Telegram, protegendo links de afiliado; envio com `parseMode: 'html'`
- **`TelegramMessagingEngineAdapter.ts`** — `msgType` no enum do Baileys (a captura testava `IMAGE` e recebia `image`); mídia recebida baixada para o storage com a regra do WhatsApp (contato sempre, grupo com download automático); prévia de link nativa; menções ignoradas
- **`chat/domain/services/conversationChannel.ts`** — conversa grava `channel: 'telegram'` quando a sessão é Telegram (ingestão, nova conversa, grupo escolhido como destino)
- **`ProcessDueOfferDispatchesUseCase.ts`** — `TELEGRAM_FLOOD_WAIT` reagenda o envio (`notBefore` = agora + espera) em vez de falhar; espera ≥ 6 h falha
- **`offer.schema.ts`** — `groupJid` aceita ids de grupo do Telegram (`-…`, `-100…`)

#### Backend — Limites do plano por canal (`tenants`, `automation`, `campaigns`, `sessions`) — api 0.52.0

- **`tenants/domain/channelLimits.ts`** — regras puras: chave de limite por (tipo, engine), contagem/corte por canal, `requiresCrossSession` (só 2+ sessões do mesmo canal). Novas chaves `telegram_monitored_groups` e `telegram_broadcast_groups` (LITE 0/0, PRO 2/10, MAX 6/40); `monitored_groups`/`broadcast_groups` passam a ser do WhatsApp
- **`GroupMonitorConfigUseCases.ts`**, **`ProcessPendingCapturedOffersUseCase.ts`** — grupos monitorados e de disparo contados e cortados por canal (canal = engine da sessão dona); DTO com `channel`, `limits`/`usage` por canal (campos da raiz = WhatsApp, legado)
- **`OfferGeneratorConfigUseCases.ts`**, **`SendOfferUseCase.ts`**, **`offer.schema.ts`** — gerador limita sessões e grupos por canal; `GET /config` devolve `limits`/`usage` por canal
- **Migration `20261104120000_add_channel_limit_entitlement_presets`** — presets de sessões, grupos por canal, menção, IA e sessão cruzada nos três planos (até aqui ausentes em produção = ilimitado) + backfill para tenants com plano

#### Frontend — Assistentes de nova sessão redesenhados (`sessions`) — app 0.66.0

- **`sessionWizardStyle.ts`**, **`ChannelBridge.tsx`** — tokens por canal (cor da marca por modo, wash, foco, keyframes com `prefers-reduced-motion`) e a "ponte" celular ↔ canal (parada, aguardando, conectado)
- **`SessionWizardDialog.tsx`** — cabeçalho com logo do canal, "Passo n de N", stepper próprio, transição entre passos, rodapé fixo no celular; `actions` `null` omite o rodapé
- **`ChannelPickerDialog.tsx`**, **`SessionWizardFields.tsx`** — cartões de canal com barra de uso do plano e estado bloqueado acessível; prévia viva do cartão da sessão (com borrar)
- **`SessionConnectPanel.tsx`**, **`TelegramConnectPanel.tsx`**, **`SessionConnectedPanel.tsx`** — QR com cantoneiras, código de pareamento por casas, código/2FA do Telegram com mostrar senha e nota de segurança; Pronto com celebração (sem brilhos) e atalho para o Monitoramento no WhatsApp. Corrige o título do Pronto do Telegram (mostrava "WhatsApp conectado")
- **`strings.ts`** — textos revistos (subtítulos por passo, erros com próximo passo)

#### Frontend — Logos de marca dos canais — app 0.65.0

- **`components/brandIcons.tsx`** — `WhatsAppIcon`/`TelegramIcon` (Simple Icons, CC0) com assinatura `LucideIcon` para `AppIcon`; `brandColor(canal, modo)`. `CHANNEL_ICON` usa os logos; chip do canal na cor da marca. Regra em `docs/padrao-icones.md`

#### Backend — Sessões Telegram (`sessions`, `messaging`) — api 0.51.0

- **`engines/telegram/TelegramMessagingEngineAdapter.ts`** — segundo engine atrás de `IMessagingEngine`, conta de usuário via MTProto (lib `telegram`/GramJS). Login por telefone → código no app → senha 2FA, ou por QR (`tg://login?token=`); mensagens recebidas viram `MESSAGE_RECEIVED` (texto; mídia ainda sem download); envio de texto/mídia/reação/typing; grupos (`listParticipatingGroups`, resumo, convite, participantes). Sem número da plataforma e sem segundo número do usuário. Doc: `docs/sessoes-telegram.md`
- **`engines/telegram/TelegramAuthStatePersistence.ts`** — StringSession cifrada (`ISecretCipher`, AAD `tenantId:telegram:session`) em `SessionAuthKey` chave `session`, provider `telegram`
- **`MessagingEngineRouter.ts`** — única porta para o resto do sistema; despacha pela `Session.engine` (cache sessionId → engine). `MessagingEngineFactory.createRouter` monta Baileys sempre e Telegram só com `TELEGRAM_ENGINE_ENABLED` + `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` + cifra
- **`IMessagingEngine`** — `requestLoginCode`/`submitLoginCode`/`submitLoginPassword` (`LoginStepResult`); Baileys responde `ENGINE_OPERATION_UNSUPPORTED`
- **`SessionLoginByCodeUseCases.ts`** / **`session.routes.ts`** — `POST /sessions/:id/telegram/send-code|sign-in|password`; `GET /sessions/limits` (usadas/limite por canal, `telegram.enabled`); `POST /sessions` aceita `engine: 'telegram'` (telefone internacional, `normalizeInternationalPhone`)
- **`SessionStatus`** — `AWAITING_CODE`, `AWAITING_PASSWORD` (migration `20261103120000_add_telegram_session_statuses`)
- **`entitlementKeys.ts`** / **`planPresets.ts`** — `telegram_sessions` 0 / 1 / 2 (Lite / Pro / Max)
- **`TelegramErrors.ts`** / **`MessagingErrors.ts`** — `TELEGRAM_PHONE_INVALID`, `TELEGRAM_CODE_INVALID`, `TELEGRAM_CODE_EXPIRED`, `TELEGRAM_PASSWORD_INVALID`, `TELEGRAM_FLOOD_WAIT` (429, `meta.seconds`), `TELEGRAM_LOGIN_NOT_PENDING`, `ENGINE_DISABLED` (503), `ENGINE_OPERATION_UNSUPPORTED` (422)

### Fixed

- **`TelegramMessagingEngineAdapter.sendMediaMessage`**, **`DispatchOutboundMediaUseCase.ts`** — mídia enviada pelo painel no Telegram ficava com o id provisório `tg-…` (eco descartado): citação e reação a ela quebravam. Agora grava o id real `<peer>_<msgId>` junto com o `SENT` (api 0.53.1)
- **`ProcessDueOfferDispatchesUseCase.ts`** — espera de `FLOOD_WAIT` usava o mesmo relógio da sessão offline (queda depois de flood derrubava envios na hora) e não tinha teto acumulado; agora relógios separados e 6 h de flood → `FAILED`
- **`whatsappToTelegramHtml.ts`** — URL colada em trecho de código vazava caractere de controle
- **`PrismaGroupMonitorRepository.tenantGroupJids`** — grupos de sessão apagada contavam na cota do canal

- **`TelegramMessagingEngineAdapter.listParticipatingGroups`**, **`mergeSessionGroups.ts`** — grupos do Telegram apareciam só com iniciais: a foto de grupo vinha apenas da conversa do chat (preenchida pela sincronização do WhatsApp). A listagem do Telegram agora traz `avatarUrl` (storage, por `photoId`, download em fila) e grava a foto nas conversas via `GROUP_AVATAR_UPDATED` (api 0.51.3)

- **`engines/telegram/TelegramMessagingEngineAdapter.ts`** — sessão Telegram ficava sem avatar em todo o painel (cards de sessão, seletor e resumo do Monitoramento, chips de grupos de disparo): `fetchProfilePicture` devolvia `null`. Agora baixa a foto da conta (ou de grupo/contato), salva no storage e cacheia 6 h, como o WhatsApp (api 0.51.2)

#### Monitoramento — intervalo entre envios a partir de 0 (api 0.51.1 · app 0.64.1)

- **`automation/domain/services/monitorSettings.ts`**, **`app/.../monitoring/utils/settingsDraft.ts`** — a faixa do intervalo começava em 1 min (60 s) e não permitia envio sem espera; piso agora é 0 (API e slider). Padrão 15–40 min mantido; fila já tratava gap 0 (`GREATEST(..., 0)`).

- **`PrismaSessionRepository.createWithinLimit`** — contava todas as sessões do tenant contra `whatsapp_sessions`; agora conta por engine (`SessionLimit.engine`), senão a 1ª sessão Telegram estouraria o limite do WhatsApp

### Changed

#### Backend — prisma/seed

- **`prisma/seed.ts`** — Lista `ADMINS` virou `TENANT_USERS` com campo `role`; o upsert de `UserTenant` passa a atualizar `role`. Adicionadas duas contas isoladas, cada uma com tenant próprio (`pedro-rodrigues`, `israel-daywis`) e dono ADMIN sem `isSuperAdmin`: `pedrorodrigues.silva5@gmail.com` e `eu.israeldaywis@gmail.com`. Flag `exclusive` remove vínculos com outros tenants (os dois estavam como `OPERATOR` no `acme-corp` em produção). Não têm acesso a Acme/Beta (isolamento por `tenantId`). Senha padrão do seed.

### Added

#### Backend — Provedores de IA (`assistants`)

- **`assistants/*`** — dois modos (IA da plataforma × chave do tenant) com invariante "nunca os dois desligados" (`platform_settings`); provedores da plataforma (`ai_platform_providers`) e chave do tenant (`tenant_ai_credentials`) cifrados com `ISecretCipher`; resolução por plano (`ai_rewrite_enabled`) e teto diário atômico (`ai_requests_per_day`, padrão 200); adapters Anthropic (`claude-haiku-5-5`) e OpenAI por `fetch`; log de uso sem conteúdo (`ai_usage_logs`); porta `IAiTextGenerator`
- **`ai.routes.ts`** — `/api/admin/ai` (super admin) e `/api/ai` (tenant). Doc: `docs/ia-provedores.md`
- **`aiProviderCatalog.ts`** — catálogo de provedores (Anthropic, OpenAI, Gemini, xAI, DeepSeek, Groq, Mistral, OpenRouter, endpoint próprio compatível com OpenAI): protocolo, URL base, modelo padrão, parâmetro de teto; `GET /api/ai/catalog` e `/api/admin/ai/catalog`. Migration `20261027090000_extend_ai_provider_kinds` (enum + `ai_platform_providers.baseUrl`)
- **`OpenAiCompatibleTextAdapter.ts`** — substitui `OpenAiTextAdapter`: Chat Completions em qualquer URL base; `max_completion_tokens` só na OpenAI, `max_tokens` nos demais; `fetch` sem seguir redirect
- **`customBaseUrl.ts`** / **`DnsAiBaseUrlGuard.ts`** — endpoint próprio (só super admin): https, porta padrão, sem IP/userinfo/host interno, ≤ 300; DNS público ao salvar e antes de cada chamada (rebinding). Tenant não pode usar `OPENAI_COMPATIBLE`

#### Frontend — Provedores de IA (`features/ai`)

- **`AiProviderDialog.tsx`** / **`TenantAiKeyForm.tsx`** — seletor montado pelo catálogo da API, modelo sugerido por tipo, campo "URL da API" no endpoint próprio, link de chave por provedor; erro de cifra detalhado só para super admin

#### Backend — Gerador de ofertas v2 (`campaigns`)

- **`OfferGeneratorConfigUseCases`** — `/config`: sessão, grupos (≤ `broadcast_groups`) e intervalo; substitui `/destinations`
- **`verifyAffiliateLink.ts`** — o link colado é o do usuário; bloqueia link de terceiro (Amazon `tag`, ML `matt_word`) e link sem afiliado
- **`HttpProductPageReader.ts`** / **`parseProductPage.ts`** — dados de ML/Amazon pela página (com sessão da extensão no ML), fallback manual
- **`OfferTextComposer`**, **`buildOfferTextPrompt.ts`**, **`RegenerateOfferTextUseCase`** — cupom, público-alvo com IA, gerar novamente, fallback para o modelo fixo
- **Marcar todos** — menções em texto e mídia (`mention_all_enabled`)

#### Backend — Sessão

- **`normalizeBrazilPhone.ts`**, **`RequestSessionPairingCodeUseCase`** — `declaredPhone`, `phoneMismatch` e pareamento por código (`POST /sessions/:id/pairing-code`, `requestPairingCode` na Baileys). Doc: `docs/sessoes-conexao.md`
- **Migration `20261026210000_add_session_phone_ai_providers_offer_config`**

#### Frontend

- **`features/sessions/`** — assistente "Nova sessão" em 4 passos com contagem regressiva do QR e conexão por código
- **`features/ai/`**, **`AdminAiPage`**, **`AiSettingsPage`** — IA da plataforma (super admin) e chave própria do cliente
- **`features/offers/`** — configuração guiada, link + cupom + público, prévia estilo WhatsApp, editar, gerar novamente, marcar todos e disparo

### Removed

- **`/campaigns/offers/destinations`**, geração de link de afiliado pelo sistema (`buildAffiliateUrl.ts`)

### Added

#### Backend — Gerador de ofertas (`campaigns`, M1-P)

- **`campaigns/domain/services/*`** — funções puras: marketplace por host com allowlist (`detectMarketplace`/`isSupportedProductUrl`), referência do produto, link de afiliado Amazon/ML, texto da oferta, agenda espaçada dos envios, início do dia em `America/Sao_Paulo`
- **`ShopeeAffiliateClient.ts`** — Affiliate Open API (assinatura SHA256), `productOfferV2` + `generateShortLink`, erros traduzidos sem vazar segredo
- **`HttpShortLinkExpander.ts`** / **`HttpOfferImageFetcher.ts`** — redirect manual revalidando cada salto (anti-SSRF); foto só de CDN permitida, ≤ 5 MB
- **`GenerateOfferUseCase`**, **`UpdateOfferUseCase`**, **`SendOfferUseCase`**, **`ProcessDueOfferDispatchesUseCase`**, destinos e uso — gerar, revisar, enviar espaçado e limite diário `offer_generations_per_day` (`PLAN_LIMIT_REACHED`, recontagem sob advisory lock)
- **`OfferDispatchWorker.ts`** — envio durável no banco (`SKIP LOCKED` + `claimToken`), atrás de `OFFER_DISPATCH_WORKER_ENABLED` (padrão `false`)
- **`offer.routes.ts`** — `/api/campaigns/offers` (gerar, editar, enviar, uso, destinos)
- **`SendStoredMediaMessageUseCase.ts`** (chat) — envia imagem já guardada no store; cada mensagem recebe a própria cópia
- **`ListConversationsUseCase`** — filtro opcional `isGroup`
- **`OfferErrors.ts`**, **`PlanErrors.ts`**, **`MediaNotFoundError`** — erros internos novos
- **Migration `20261026160000_create_offers_and_dispatches`** — tabelas `offers`, `offer_dispatches`, `offer_destinations`
- Doc: `docs/gerador-de-ofertas.md`

#### Frontend — Gerador de ofertas

- **`features/offers/`** + **`OfferGeneratorPage.tsx`** — colar link, prévia, edição (preço em BRL, foto por upload em partes, texto), destinos, confirmação e progresso por destino; rota `/offers` e item no menu

### Changed

- **`ResolveAffiliateCredentialUseCase.ts`** — decifra a sessão só para provider que usa sessão (ML); JSON inválido não vaza o texto decifrado na mensagem de erro

### Fixed

- **`detectMarketplace.ts`**, **`HttpShortLinkExpander.ts`**, **`GenerateOfferUseCase.ts`** — link curto `meli.la` do Mercado Livre era recusado como "não suportado": domínio fora da allowlist e o destino (`/social/<etiqueta>?matt_word=`) não traz o ID do produto. Agora expande, mantém o link colado como link de afiliado e marca atribuição verificada quando a etiqueta bate com a credencial
- **`DispatchOutboundMediaUseCase.test.ts`**, **`RetryOutboundMediaUseCase.test.ts`** — fakes adaptados ao `acquireLocalFile` do E1 (22 testes quebrados)

#### Backend — S3/R2 Media Storage (E1)

- **`IMediaFileStore.ts`** — contrato estendido com `saveBuffer`, `mediaExists`, `publicUrl` e `acquireLocalFile` (+ tipo `AcquiredMediaFile` com `release()` para limpeza de temporários)
- **`S3MediaFileStore.ts`** — implementação S3-compatível (Cloudflare R2) do `IMediaFileStore`: upload via `PutObjectCommand`, download sob demanda para arquivo temporário (`acquireLocalFile`), remoção e verificação de existência via `HeadObject`
- **`LocalMediaFileStore.ts`** — métodos novos do contrato implementados delegando ao legado `MediaStorage` (sem mudança de comportamento para `MEDIA_STORAGE_DRIVER=local`)
- **`mediaContainer.ts`** — swap point agora escolhe `S3MediaFileStore` ou `LocalMediaFileStore` conforme `env.S3_ENABLED`
- **`env.ts`** — variáveis `MEDIA_STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`; derivada `S3_ENABLED`
- **`@aws-sdk/client-s3`**, **`@aws-sdk/s3-request-presigner`** — dependências adicionadas (v3.679.0)

#### Backend — Migração de consumidores para novo contrato de mídia

- **`BaileysMessagingEngineAdapter.ts`** — substituídas chamadas diretas a `saveMediaBuffer`/`mediaFileExists`/`mediaPublicUrl` (legado `MediaStorage`) por `mediaContainer.mediaFileStore.saveBuffer`/`mediaExists`/`publicUrl`; adapter agora funciona com disco ou S3 sem alteração
- **`DispatchOutboundMediaUseCase.ts`** — `resolveLocalPath` + `exists` substituídos por `acquireLocalFile` com `try/finally release()`, permitindo envio de mídia armazenada em S3 (download temporário transparente)
- **`RetryOutboundMediaUseCase.ts`** — verificação de existência migrada para `acquireLocalFile` + `release()` imediato

#### Frontend — CSP correto do painel versionado no Blueprint

- **`render.yaml`** — adiciona `Content-Security-Policy` em `/*` com `connect-src`/`media-src` em `api.copysync.app` (+ `wss:`) e `style-src 'unsafe-inline'` (MUI/Emotion); o CSP configurado à mão no dashboard apontava para domínios de outro projeto e bloqueava estilos inline, deixando login impossível e layout quebrado
- **`docs/app-bloqueio-indexacao.md`** — tabela explicando cada diretiva, registro do incidente e aviso para atualizar o header ao trocar domínio

#### Frontend — Painel invisível para buscadores (app.copysync.app)

- **`app/public/robots.txt`** — `Disallow: /` para todo `User-agent`; o painel é área privada e nenhum crawler deve rastreá-lo
- **`app/index.html`** — `<meta name="robots">` (+ `googlebot`, `bingbot`) com `noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate`; impede indexação mesmo se a URL for descoberta por link externo
- **`render.yaml`** — header `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` em `/*`, cobrindo também JS, CSS, imagens e manifest (a meta tag só vale para HTML); adiciona `X-Content-Type-Options: nosniff` e `Referrer-Policy`
- **`docs/app-bloqueio-indexacao.md`** — como as três camadas se complementam, por que `robots.txt` sozinho não basta e como verificar após deploy

#### Backend — Vitest

- **`vitest.config.mts`**, **`tsconfig.build.json`**, **`package.json`** — runner de testes na API, com testes co-locados (`Arquivo.test.ts` ao lado do código) e exclusão dos testes do build. Cobertura exigida por camada em `.specs/codebase/TESTING.md`: use cases, mappers e funções puras têm teste; repositórios Prisma e rotas Fastify seguem no smoke manual
- **`src/shared/utils/passwordPolicy.test.ts`** — primeiro teste, sobre código existente, garantindo que a política devolve todas as falhas de uma vez e lança `WeakPasswordError`

### Fixed

#### Backend — History sync do Baileys agora é realmente opt-in

- **`BaileysMessagingEngineAdapter.ts`** — adiciona guard clauses logo na entrada dos handlers de `messages.upsert` do tipo `append` e `messaging-history.set`; quando `BAILEYS_SYNC_FULL_HISTORY=false`, o fluxo retorna antes de chamar `mapMessagesToHistoryItems()` e antes de acionar `IngestHistorySyncUseCase`, impedindo que o reconnect dispare ingestão em lote de histórico no banco
- **`BaileysMessagingEngineAdapter.ts`** — mantém intacto o fluxo de mensagens em tempo real (`type === 'notify'`), então o corte atua apenas no histórico/gap sync; na prática, a API continua recebendo mensagens novas normalmente, mas deixa de abrir a sequência pesada de queries de contatos, conversas e mensagens históricas que estava pressionando o PostgreSQL da Render após reconectar sessões existentes

#### Backend — Deploy seguro sem reconexão automática de sessões WhatsApp

- **`api/src/shared/config/env.ts`** — adiciona `SESSION_BOOTSTRAP_ON_STARTUP` com default `false`, impedindo que a API reconecte sessões WhatsApp automaticamente a cada boot/deploy; isso evita que o startup dispare o Baileys, carregue blobs grandes de `session_auth_states` e gere novos `upsert`s enquanto o PostgreSQL ainda está instável ou enquanto `prisma migrate deploy` tenta validar o banco
- **`api/src/shared/config/env.ts`** — adiciona `SESSION_BOOTSTRAP_MAX_CONCURRENT` com default `1`, permitindo reativar o bootstrap de forma controlada sem reconectar várias sessões em paralelo
- **`api/src/app/server.ts`** — envolve o bootstrap em `if (env.SESSION_BOOTSTRAP_ON_STARTUP)`; quando desligado, a API sobe normalmente, registra os listeners e deixa as sessões desconectadas até reconexão manual pela API/UI, preservando disponibilidade HTTP e reduzindo pressão no banco durante deploy
- **`api/src/modules/sessions/application/services/SessionBootstrapService.ts`** — substitui o `Promise.allSettled` sobre todas as sessões por batches limitados por `maxConcurrent`; quando o bootstrap for ligado explicitamente, as reconexões passam a ocorrer de forma sequencial/controlada, evitando avalanche simultânea de conexão Baileys e persistência de auth state

#### Backend — Persistência do auth state do Baileys: eliminação de upserts desnecessários

- **`BaileysAuthStatePersistence.ts`** — adicionada `areSerializedValuesEqual(left, right)` que compara `JSON.stringify` de dois valores serializados; usada internamente para detectar se um valor realmente mudou antes de marcar o estado como sujo, eliminando gravações em banco provocadas por chamadas repetidas do Baileys com os mesmos dados
- **`BaileysAuthStatePersistence.ts`** — nova função `setStateValue(key, value)` que serializa o novo valor com `BufferJSON.replacer`, compara com o que já está no `stateMap` e só grava se houver diferença; retorna `true` apenas quando a mudança foi efetiva, permitindo que `saveCreds` e `keys.set` decidam de forma confiável se há algo a persistir
- **`BaileysAuthStatePersistence.ts`** — nova função `deleteStateValue(key)` que verifica com `hasOwnProperty` se a key existe antes de deletar; retorna `true` somente quando a remoção ocorreu de fato, evitando que `keys.set` marque dirty em tentativas de deletar keys inexistentes
- **`BaileysAuthStatePersistence.ts`** — nova função `markStateDirty()` que centraliza a atribuição `hasPendingPersist = true`; substitui o flag `dirtyAfterPersistStarted` com nome mais claro e semântica explícita de "há mudanças aguardando a próxima janela de persistência"
- **`BaileysAuthStatePersistence.ts`** — `persistStateWithRetry` passou a receber `statePayload: Record<string, unknown>` em vez de capturar `stateMap` pela closure; a chamada em `flushState` faz `{ ...stateMap }` antes de entrar no loop, garantindo que o snapshot gravado no banco corresponde ao estado no momento em que o flush começou — mudanças que chegam durante o `upsert` assíncrono não são gravadas parcialmente nem perdidas
- **`BaileysAuthStatePersistence.ts`** — `flushState` usa o snapshot explícito e mantém o loop `do … while (hasPendingPersist)` para repetir automaticamente se novas mudanças chegaram enquanto a gravação anterior ainda estava em andamento; a remoção do bloco `if (persistInFlight) { dirtyAfterPersistStarted = true; return }` anterior evita que uma segunda entrada em `flushState` ignore silenciosamente mudanças já marcadas
- **`BaileysAuthStatePersistence.ts`** — novo helper `scheduleDirtyStatePersist()` que combina `markStateDirty()` e `schedulePersistState()` em uma única chamada; simplifica `saveCreds` e `keys.set` que antes chamavam `schedulePersistState()` diretamente sem garantir que `hasPendingPersist` estava setado
- **`BaileysAuthStatePersistence.ts`** — `saveCreds` agora chama `setStateValue(CREDS_KEY, creds)` e agenda persistência somente se o valor retornado for `true`; elimina flushes causados pelo Baileys ao chamar o callback `creds.update` com as mesmas credenciais já persistidas (comportamento comum durante heartbeat e reconfirmação de sessão)
- **`BaileysAuthStatePersistence.ts`** — `keys.set` substitui o `dirty = true` incondicional por `dirty = setStateValue(key, value) || dirty` e `dirty = deleteStateValue(key) || dirty`; a persistência só é agendada quando pelo menos uma key teve mudança efetiva, eliminando upserts disparados por chamadas `keys.set` com dados idênticos aos já armazenados (frequentes durante descriptografia e sincronização de mensagens históricas)

### Changed

#### Backend — Simplificação do BaileysMessagingEngineAdapter: remoção de grupos, mídia, avatares e reply

- **`BaileysMessagingEngineAdapter.ts`** — refactor profundo que reverte o adapter a um estado estável focado exclusivamente em mensagens individuais (`@s.whatsapp.net`):
  - **Mensagens de grupo removidas**: `@g.us` agora é filtrado junto com `@broadcast` em `messages.upsert`; toda lógica de `isGroup`, `groupJid`, `groupName`, `participant` (incluindo resolução de LID de participante via `signalRepository.lidMapping.getPNForLID`) e `participantName` foi removida — os campos correspondentes deixaram de ser emitidos no evento `MESSAGE_RECEIVED`
  - **Download automático de mídia removido**: removidos imports de `downloadMediaMessage`, `saveMediaBuffer`, `mediaPublicUrl` e `mediaFileExists`; removido o cache in-memory `autoDownloadCache` e a dependência de `IChatConversationRepository`; o campo `mediaUrl` não é mais emitido no evento `MESSAGE_RECEIVED`
  - **Reply/quoted no envio removido**: `sendTextMessage` simplificado — a construção de `WAMessage` com proto por tipo (`imageMessage`, `videoMessage`, `audioMessage`, `documentMessage`, `conversation`) e o terceiro argumento `{ quoted }` do `socket.sendMessage()` foram removidos; envio é agora `socket.sendMessage(jid, { text: input.body })` puro
  - **Fetch de avatar em background removido**: chamadas `fetchAndSaveContactAvatar` eliminadas tanto no handler `messages.upsert` (para contatos individuais e grupos) quanto no handler `contacts.upsert`; o `contacts.upsert` agora chama `chatContactRepo.upsert({ tenantId, phone, name })` direto, sem await de avatar
  - **`mapMessagesToHistoryItems` simplificado**: método alterado de `async` para síncrono; parâmetros `socket` e `sessionId` removidos; grupos e broadcasts são filtrados; callback de `messages.upsert` e `messaging-history.set` passam de `async () =>` para `() =>`
  - **Imports removidos**: `downloadMediaMessage`, `WAMessage`, `IChatConversationRepository`, `saveMediaBuffer`, `mediaPublicUrl`, `mediaFileExists`

### Added

#### Backend — Resolução de LID → WID (phone real) em mensagens de grupo

- **`BaileysMessagingEngineAdapter.ts`** — ao extrair o `participant` de uma mensagem de grupo, detecta se o JID retornado termina em `@lid` (Linked Identity do WhatsApp); quando há LID, chama `socket.signalRepository.lidMapping.getPNForLID(lid)` para resolver o número de telefone real (`@s.whatsapp.net` → dígitos puros); fallback seguro para o LID bruto caso a resolução falhe. Isso garante que `fromParticipant` sempre carregue o WID/phone real exibido na sidebar de conversas, não um identificador interno do WhatsApp.

#### Frontend — Menu de contexto nas mensagens de grupo

- **`MessageBubble.tsx`** — ao passar o mouse sobre qualquer balão de mensagem aparece um botão `⌄` no canto superior direito (gradiente de fundo igual à cor do bubble, animação de opacidade); clicar abre um `<Menu>` MUI com as opções:
  - **Responder** — ativa o bloco de reply (mesmo comportamento do botão lateral já existente)
  - **Copiar** — copia o texto da mensagem para o clipboard via `navigator.clipboard`
  - **Conversar com [nome]** — visível apenas em mensagens de grupo recebidas; chama `onParticipantClick(phone, name)` para navegar à conversa direta com o participante

#### Frontend — Nome do participante clicável nos grupos

- **`MessageBubble.tsx`** — linha do nome/telefone do remetente em mensagens de grupo ganhou cursor pointer e underline no hover quando o handler `onParticipantClick` estiver disponível; clicar abre a conversa direta com aquele número; nova prop `onParticipantClick?: (phone: string, name: string) => void`

#### Frontend — Cadeia de propagação de `onParticipantClick`

- **`MessageList.tsx`** — nova prop `onParticipantClick?: (phone: string, name: string) => void` repassada para cada `<MessageBubble>`
- **`ChatWindow.tsx`** — nova prop `onParticipantClick` declarada e repassada para `<MessageList>`
- **`ChatPage.tsx`** — `handleParticipantClick` criado: busca em `conversations` a primeira conversa individual (`isGroup = false`) cujo `contact.phone === phone` e a seleciona via `handleSelectConversation`; caso não exista conversa direta com o contato, a ação é silenciosa

---

## [0.11.0] — 2026-03-21 — Chat V7: reply entregue no WhatsApp, bloco citado persistente e regras de processo no AGENTS.md

### Fixed

#### Backend — Reply nunca chegava ao destinatário no WhatsApp

- **`IMessagingEngine.ts`** — `SendTextMessageInput` ganhou campo `quotedMessage?: QuotedMessageRef | null`; novo tipo `QuotedMessageRef` com `externalId`, `remoteJid`, `fromMe`, `body` e `type` (tipo da mensagem citada, necessário para montar o proto correto)
- **`SendMessageUseCase.ts`** — busca a mensagem citada no repositório **antes** de chamar a engine (em vez de depois); passa `QuotedMessageRef` completo para `engine.sendTextMessage()` incluindo `externalMessageId`, `direction`, `type` e `content`; elimina o segundo `findById` redundante que existia apenas para montar o DTO de retorno
- **`BaileysMessagingEngineAdapter.ts`** — `sendTextMessage` agora constrói um `WAMessage` mínimo e passa como terceiro argumento (`{ quoted }`) ao `socket.sendMessage()`; proto `IMessage` montado por tipo para evitar crash: `image → imageMessage`, `video → videoMessage`, `audio → audioMessage`, `document → documentMessage`, `text/outros → conversation` com fallback `' '` para evitar que proto3 descarte string vazia (o que causava `TypeError: cannot read property of undefined` no `getContentType()` do Baileys)

#### Frontend — Bloco de mensagem citada sumia ~1s após o envio

- **`ChatPage.tsx`** — no `.then()` do `chatService.sendMessage()`, após substituir o otimístico pela mensagem real, aplica `resolveQuotedMessages` ao array completo para repopular `quotedMessage` a partir das mensagens já em memória; mesma correção aplicada ao handler WS `chat.message.created` (mensagens recebidas com `quotedMessageId` também são resolvidas)
- **`chat.api.types.ts`** — `ChatMessageApiDto` ganhou campo opcional `quotedMessage?: { id, type, content, mediaUrl, direction, isDeleted } | null`; `apiMessageToFrontend()` mapeia `dto.quotedMessage` para `QuotedMessagePreview` quando presente, eliminando dependência exclusiva do `resolveQuotedMessages` client-side
- **`ListMessagesUseCase.ts`** — novo tipo exportado `QuotedMessageSummary`; `ChatMessageDto` ganhou campo opcional `quotedMessage?: QuotedMessageSummary | null`
- **`ChatPresenter.ts`** — `presentMessage()` serializa `quotedMessage: dto.quotedMessage ?? null` na resposta HTTP
- **`SendMessageUseCase.ts`** — DTO de retorno inclui `quotedMessage` já resolvido (usando a entidade buscada antes do envio), sem custo de consulta adicional

### Changed

#### Docs — AGENTS.md: regras de processo e versionamento

- **`AGENTS.md`** — adicionadas seções 31–36 adaptadas ao monorepo WaioPrime: fluxo Git obrigatório (branches, workflow de feature/release/hotfix), SemVer com portadores de versão em `api/package.json` + `app/package.json` + `api/CHANGELOG.md` + TAG Git, template de documentação de feature no CHANGELOG, template de seção de release, padrão de commits com escopos (`auth`, `sessions`, `messaging`, `chat`, etc.), template de PR e lista de proibições absolutas de processo

---

## [0.10.0] — 2026-03-12 — Chat V6: envio real via WhatsApp, funcionalidade Responder e player nativo de mídia

### Fixed

#### Backend — Envio de mensagem nunca chegava ao WhatsApp

- **`SendMessageUseCase`** — corrigida falha crítica: o use case salvava a mensagem no banco mas **nunca chamava a engine** para enviar via WhatsApp. Adicionadas dependências `IChatContactRepository` e `IMessagingEngine | null`; agora o fluxo é: busca conversa → busca contato → chama `engine.sendTextMessage()` → salva no banco com o `externalMessageId` retornado pelo Baileys. Se a engine estiver indisponível (sessão desconectada), loga warning e salva sem envio real (sem quebrar o sistema)
- **`chat.routes.ts`** — `SendMessageUseCase` passou a ser instanciado **por-request** (igual ao `MarkConversationAsReadUseCase`), recebendo `contactRepo` e `getActiveEngine()` atualizados no momento do envio

### Added

#### Backend — Suporte a `quotedMessageId` no envio

- **`sendMessageBodySchema`** — campo opcional `quotedMessageId: string` adicionado ao schema de validação do Fastify
- **`SendMessageInput`** — aceita `quotedMessageId?: string | null`
- **`SendMessageUseCase`** — persiste `quotedMessageId` junto com a mensagem criada

#### Frontend — Funcionalidade Responder (reply)

- **`MessageBubble.tsx`** — hover sobre qualquer balão exibe botão `ReplyIcon` lateral (à esquerda para mensagens enviadas, à direita para recebidas); animação de opacidade `0 → 1` no hover; `onReply?: (message: ChatMessage) => void` como prop opcional
- **`MessageList.tsx`** — nova prop `onReply?: (message: ChatMessage) => void` repassada para cada `<MessageBubble>`
- **`MessageComposer.tsx`** — novas props `replyTo?: QuotedMessagePreview | null` e `onCancelReply?: () => void`; exibe banner acima do input com borda colorida lateral (`primary.main`), ícone e label do tipo da mensagem citada (Imagem, Áudio, Vídeo, Documento), texto truncado, botão `CloseIcon` para cancelar
- **`ChatWindow.tsx`** — gerencia estado `replyTo: ChatMessage | null`; `useEffect` limpa o reply ao trocar de conversa; `handleReply` e `handleCancelReply` encadeados para `MessageList` e `MessageComposer`; `handleSend` inclui `quotedMessageId` e limpa o reply após envio; constrói `QuotedMessagePreview` para passar ao composer; assinatura `onSendMessage` atualizada para `(text: string, quotedMessageId?: string | null) => void`
- **`chat.service.ts`** — `sendMessage()` aceita terceiro argumento `quotedMessageId?: string | null` e o inclui no body quando presente
- **`ChatPage.tsx`** — `handleSendMessage` inclui `quotedMessageId`; constrói `quotedMessage` otimista a partir do estado local de mensagens para exibição imediata; `resolveQuotedMessages()` popula `quotedMessage` em todos os itens ao carregar mensagens da API (lookup por `quotedMessageId` dentro do batch)

#### Frontend — Player nativo de áudio

- **`AudioMessage.tsx`** — substituído player customizado (MUI `Slider` + `IconButton`) por `<audio controls>` nativo; o browser fornece play/pause, barra de progresso, volume e menu ⋮ com "Baixar", "Velocidade da reprodução" e "PiP" sem código adicional; `minWidth: 280`, sem altura fixa para não cortar controles

---

## [0.9.0] — 2026-03-12 — Chat V5: tipos de mensagem, metadados, renders dedicados e paginação reversa

### Added

#### Backend — Novos tipos de mensagem

- **`ChatMessageType` (enum)** — adicionados `VIDEO`, `LOCATION`, `VCARD`, `CALL_LOG`; enum completo: `TEXT | IMAGE | AUDIO | DOCUMENT | VIDEO | STICKER | LOCATION | VCARD | CALL_LOG | EVENT`
- **`ChatMessage` (entidade de domínio)** — adicionados campos: `fileName?: string`, `durationSeconds?: number`, `isDeleted?: boolean`, `quotedMessageId?: string`
- **`IChatMessageRepository`** — `ChatMessageCreateData` extendido com os quatro novos campos
- **`PrismaChatMessageMapper`** — `toDomain()` mapeia os quatro novos campos do modelo Prisma para a entidade
- **`PrismaChatMessageRepository`** — `create()` persiste os quatro novos campos

#### Backend — Migração Prisma `20260312110628_add_message_types_and_fields`

- **`schema.prisma`** — `ChatMessageType` enum expandido; `ChatMessage` model com `fileName String?`, `durationSeconds Int?`, `isDeleted Boolean @default(false)`, `quotedMessageId String?`; relação auto-referencial `quotedMessage / quotedBy` para replies

#### Backend — Use cases atualizados

- **`ListMessagesUseCase`** — `ChatMessageDto` inclui `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`
- **`SendMessageUseCase`** — retorno agora inclui todos os campos do `ChatMessageDto`
- **`IngestIncomingMessageUseCase`** — input aceita `msgType?`, `mediaUrl?`, `mimeType?`, `fileName?`, `durationSeconds?`, `isDeleted?`, `quotedMessageId?`, `body: string | null`; tipo persistido via `input.msgType ?? TEXT`; função auxiliar `buildPreview()` com labels emoji por tipo
- **`IngestHistorySyncUseCase`** — `HistoryMessageItem` aceita todos os novos campos; `processChunk` usa `item.msgType ?? TEXT`; função auxiliar `buildHistoryPreview()`

#### Backend — Adapter Baileys: extração completa de mensagens

- **`BaileysMessagingEngineAdapter`** — nova função `extractBaileysMessage(m)` que detecta e extrai dados estruturados para todos os tipos: `TEXT` (conversation, extendedTextMessage), `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `STICKER`, `LOCATION` (lat/lng → string `"lat,lng"`), `VCARD` (contactMessage, contactsArrayMessage), `CALL_LOG` (call); extrai `mimeType`, `fileName`, `durationSeconds`, `isDeleted` (via protocolMessage.type===0), `quotedMessageId` (via contextInfo.stanzaId); retorna `null` para reactionMessage, pollCreationMessage e protocolMessages não-deleção (não ingere)
- Handlers `messages.upsert` e `mapMessagesToHistoryItems` migrados para usar `extractBaileysMessage()` em vez de extração manual de texto

#### Backend — Eventos e apresentação

- **`InternalMessagingEvent`** — `MESSAGE_RECEIVED` contém `body: string | null`, `msgType?`, `mediaUrl?`, `mimeType?`, `fileName?`, `durationSeconds?`, `isDeleted?`, `quotedMessageId?`
- **`ChatPresenter`** — `presentMessage()` serializa `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`
- **`ChatWebSocketPublisher`** — tipo `chat.message.created` inclui os quatro novos campos
- **`ChatIncomingMessageListener`** — passa todos os novos campos do payload para o use case e para o publish WS

#### Frontend — Tipos atualizados

- **`features/chat/types.ts`** — `MessageType` expandido com `'video' | 'location' | 'vcard' | 'call_log'`; nova interface `QuotedMessagePreview`; `ChatMessage.body` agora `string | null`; `ChatMessage` com `mimeType?`, `isDeleted?`, `quotedMessageId?`, `quotedMessage?`
- **`chat.api.types.ts`** — `ApiMessageType` expandido; `ChatMessageApiDto` com `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`; `apiMessageToFrontend()` mapeia todos os novos campos

#### Frontend — Componentes de renderização dedicados

Criado diretório `app/src/features/chat/components/messages/` com 10 componentes:

- **`ImageMessage.tsx`** — `<img>` com lightbox modal ao clicar, fallback `BrokenImageOutlined`
- **`AudioMessage.tsx`** — `<audio controls>`, detecção de PTT (ogg/opus), display de duração, fallback
- **`DocumentMessage.tsx`** — card de arquivo com ícone, label de extensão, botão de download
- **`StickerMessage.tsx`** — `<img>` para sticker, fallback `EmojiEmotionsOutlined`
- **`VideoMessage.tsx`** — `<video controls>`, display de duração, fallback de erro
- **`LocationMessage.tsx`** — card com pin vermelho, parse lat/lng, link para Google Maps
- **`VCardMessage.tsx`** — card de contato, parse de vCard (FN/TEL), ícone verde
- **`CallLogMessage.tsx`** — pill centralizado (como eventos do sistema), detecção de chamada perdida/atendida
- **`DeletedMessage.tsx`** — "Mensagem apagada" em itálico com ícone `Block`
- **`QuotedMessage.tsx`** — bloco de reply com borda colorida lateral, ícones por tipo, texto truncado

#### Frontend — `MessageBubble.tsx` reescrito

- Substituído `MediaPlaceholder` genérico pelos 10 renderers especializados
- `call_log` renderiza como pill centralizado (fora da bolha)
- `event` renderiza como pill de sistema centralizado
- `isDeleted` → `DeletedMessage`
- Citação/reply → `QuotedMessage` no topo da bolha antes do conteúdo
- Switch completo por `message.type` para cada renderer dedicado

#### Frontend — Paginação reversa (scroll infinito para cima)

- **`MessageList.tsx`** — novas props: `hasMore`, `isLoadingMore`, `onLoadMore`, `scrollToBottom`; `onScroll` detecta quando `scrollTop < 80px` e dispara `onLoadMore`; `prevScrollHeight` ref preserva posição do scroll após prepend de mensagens antigas; spinner `CircularProgress` no topo durante carregamento; scroll ao fundo apenas no load inicial e quando `scrollToBottom` muda (não em todo re-render)
- **`ChatWindow.tsx`** — aceita e repassa `hasMore`, `isLoadingMore`, `onLoadMore`, `scrollToBottom` para `MessageList`
- **`ChatPage.tsx`** — `PAGE_SIZE = 40`; estados `hasMore`, `isLoadingMore`, `oldestTimestamp` por conversa; `handleSelectConversation` carrega primeiro lote com `limit: PAGE_SIZE` e inicializa cursores; `handleLoadMore` carrega lote anterior com `before: oldestTimestamp[id]` e prepende ao array; trigger `scrollToBottom` (toggle boolean) a cada nova mensagem WS

### Fixed

#### Backend — Filtragem de JIDs LID (Linked Identity)

- **`BaileysMessagingEngineAdapter`** — adicionado filtro `@lid` em todos os handlers (`messages.upsert`, `mapMessagesToHistoryItems`, `contacts.upsert`, `presence.update`); JIDs LID do WhatsApp eram processados como telefones reais, criando contatos e conversas duplicadas com números inválidos

#### Backend — Correção de pushName em mensagens fromMe

- **`IngestIncomingMessageUseCase`** — nome do contato agora só é extraído de `fromName` (pushName) quando `fromMe === false`; evita que o nome do próprio usuário sobrescreva o nome do contato
- **`IngestHistorySyncUseCase`** — mesma correção aplicada ao ingestion de histórico

#### Backend — Proteção contra nomes numéricos em contacts.upsert

- **`PrismaChatContactRepository`** — `findOrCreate` agora promove nomes numéricos para nomes reais quando disponíveis
- **`BaileysMessagingEngineAdapter`** — handler `contacts.upsert` ignora contatos sem nome real ou com nome puramente numérico, evitando sobrescrever nomes já válidos

#### Frontend — WebSocket em dev environment

- **`useChatWebSocket.ts`** — URL do WebSocket agora usa mesma estratégia do apiClient (`VITE_API_URL` com fallback para `http://localhost:3000/api`); compatível com proxy Vite e StrictMode do React

---

## [0.8.0] — 2026-03-10 — Chat V4: presence/typing sync e refinamento de inbox

### Added

#### Backend — Presence/typing sync

- **`InternalMessagingEvent`** — novo tipo `PRESENCE_UPDATED` com `phone` e `presence` (`composing` | `recording` | `available` | `unavailable` | `paused`)
- **`BaileysMessagingEngineAdapter`** — handler `presence.update` do Baileys: extrai `lastKnownPresence` do participante, filtra grupos/broadcasts, emite evento interno `PRESENCE_UPDATED`
- **`IMessagingEngine`** — novo método `presenceSubscribe(sessionId, phone): Promise<void>` para assinar atualizações de presença de um contato
- **`BaileysMessagingEngineAdapter.presenceSubscribe()`** — chama `socket.presenceSubscribe(jid)` no Baileys
- **`ChatPresenceListener.ts`** (novo) — ouve `PRESENCE_UPDATED` no event bus interno e publica `chat.presence.updated` via WebSocket; efêmero, sem persistência
- **`chat.routes.ts`** — `POST /conversations/:id/presence` — recebe ID de conversa, resolve contato, chama `engine.presenceSubscribe()`; retorna `{ subscribed: true/false }`
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.presence.updated` com `{ tenantId, phone, presence }`
- **`server.ts`** — `registerChatPresenceListener()` registrado no startup

#### Frontend — Presence/typing em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsPresenceUpdatedData` e evento `chat.presence.updated` no union `ChatWsPayload`
- **`chat.service.ts`** — `subscribePresence(conversationId)` → `POST /chat/conversations/:id/presence`
- **`ChatPage.tsx`** — estado `presenceMap` (phone → presence); handler WS `chat.presence.updated`; chama `subscribePresence()` ao selecionar conversa
- **`ChatWindow.tsx`** — aceita e repassa prop `presence?: string`
- **`ChatHeader.tsx`** — exibe indicador de presença abaixo do nome: "online" (verde), "digitando…" (verde/itálico), "gravando áudio…" (vermelho/itálico)

#### Frontend — Refinamento de inbox

- **`ConversationListItem.tsx`** — aceita prop `presence`; quando contato está digitando ou gravando, substitui preview de última mensagem por indicador colorido ("digitando…" ou "gravando áudio…")
- **`ConversationSidebar.tsx`** — repassa `presenceMap` para cada `ConversationListItem`

- **`BaileysMessagingEngineAdapter`** — adicionado filtro `@lid` em todos os handlers (`messages.upsert`, `mapMessagesToHistoryItems`, `contacts.upsert`, `presence.update`); JIDs LID do WhatsApp eram processados como telefones reais, criando contatos e conversas duplicadas com números inválidos

#### Backend — Correção de pushName em mensagens fromMe

- **`IngestIncomingMessageUseCase`** — nome do contato agora só é extraído de `fromName` (pushName) quando `fromMe === false`; evita que o nome do próprio usuário sobrescreva o nome do contato
- **`IngestHistorySyncUseCase`** — mesma correção aplicada ao ingestion de histórico

#### Backend — Proteção contra nomes numéricos em contacts.upsert

- **`PrismaChatContactRepository`** — `findOrCreate` agora promove nomes numéricos para nomes reais quando disponíveis
- **`BaileysMessagingEngineAdapter`** — handler `contacts.upsert` ignora contatos sem nome real ou com nome puramente numérico, evitando sobrescrever nomes já válidos

#### Frontend — WebSocket em dev environment

- **`useChatWebSocket.ts`** — URL do WebSocket agora usa mesma estratégia do apiClient (`VITE_API_URL` com fallback para `http://localhost:3000/api`); compatível com proxy Vite e StrictMode do React

---

## [0.8.0] — 2026-03-10 — Chat V4: presence/typing sync e refinamento de inbox

### Added

#### Backend — Presence/typing sync

- **`InternalMessagingEvent`** — novo tipo `PRESENCE_UPDATED` com `phone` e `presence` (`composing` | `recording` | `available` | `unavailable` | `paused`)
- **`BaileysMessagingEngineAdapter`** — handler `presence.update` do Baileys: extrai `lastKnownPresence` do participante, filtra grupos/broadcasts, emite evento interno `PRESENCE_UPDATED`
- **`IMessagingEngine`** — novo método `presenceSubscribe(sessionId, phone): Promise<void>` para assinar atualizações de presença de um contato
- **`BaileysMessagingEngineAdapter.presenceSubscribe()`** — chama `socket.presenceSubscribe(jid)` no Baileys
- **`ChatPresenceListener.ts`** (novo) — ouve `PRESENCE_UPDATED` no event bus interno e publica `chat.presence.updated` via WebSocket; efêmero, sem persistência
- **`chat.routes.ts`** — `POST /conversations/:id/presence` — recebe ID de conversa, resolve contato, chama `engine.presenceSubscribe()`; retorna `{ subscribed: true/false }`
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.presence.updated` com `{ tenantId, phone, presence }`
- **`server.ts`** — `registerChatPresenceListener()` registrado no startup

#### Frontend — Presence/typing em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsPresenceUpdatedData` e evento `chat.presence.updated` no union `ChatWsPayload`
- **`chat.service.ts`** — `subscribePresence(conversationId)` → `POST /chat/conversations/:id/presence`
- **`ChatPage.tsx`** — estado `presenceMap` (phone → presence); handler WS `chat.presence.updated`; chama `subscribePresence()` ao selecionar conversa
- **`ChatWindow.tsx`** — aceita e repassa prop `presence?: string`
- **`ChatHeader.tsx`** — exibe indicador de presença abaixo do nome: "online" (verde), "digitando…" (verde/itálico), "gravando áudio…" (vermelho/itálico)

#### Frontend — Refinamento de inbox

- **`ConversationListItem.tsx`** — aceita prop `presence`; quando contato está digitando ou gravando, substitui preview de última mensagem por indicador colorido ("digitando…" ou "gravando áudio…")
- **`ConversationSidebar.tsx`** — repassa `presenceMap` para cada `ConversationListItem`
- **`ConversationDetailsPanel.tsx`** — seção "Conversa" agora exibe "Última atividade" e "Não lidas" (quando > 0)

---

## [0.7.0] — 2026-03-10 — History sync, read receipts, delivery status e fromMe

### Added

#### Backend — History sync (messaging-history.set + append)

- **`IngestHistorySyncUseCase.ts`** (novo) — recebe batch de mensagens históricas do Baileys; deduplicação por `externalMessageId`; cria contato + conversa automaticamente; persiste mensagens com timestamp original
- **`BaileysMessagingEngineAdapter`** — handlers `messaging-history.set` e `messages.upsert` type `append` delegam ao `IngestHistorySyncUseCase` via `setImmediate` (não-bloqueante)
- **`mapMessagesToHistoryItems()`** — método privado no adapter que extrai `HistoryMessageItem[]` de mensagens brutas do Baileys, filtrando grupos, broadcasts e mensagens sem conteúdo

#### Backend — Suporte a `fromMe` (mensagens enviadas pelo telefone)

- **`InternalMessagingEvent.MESSAGE_RECEIVED`** — adicionado campo `fromMe?: boolean`
- **`IngestIncomingMessageUseCase`** — recebe `fromMe`; define `direction = OUTBOUND` quando `true`; não incrementa `unreadCount` para mensagens outbound
- **`BaileysMessagingEngineAdapter`** — `messages.upsert` handler não mais pula mensagens `fromMe`; repassa o campo no evento interno

#### Backend — Read receipts (double blue tick)

- **`IMessagingEngine`** — novo método `markMessagesRead(input: MarkMessagesReadInput): Promise<void>`
- **`BaileysMessagingEngineAdapter.markMessagesRead()`** — chama `socket.readMessages()` com keys `fromMe: false`; usa `normalizeJid()` para evitar sufixo `@s.whatsapp.net` duplicado
- **`MarkConversationAsReadUseCase.ts`** (novo) — reseta `unreadCount` no DB + envia receipt da última mensagem INBOUND via engine; recebe engine como nullable (se sessão offline, só reseta DB)
- **`chat.routes.ts`** — `POST /conversations/:id/read` chama o use case e publica `chat.unread.updated` via WS
- **`chat.service.ts` (frontend)** — `markAsRead(conversationId)` → `POST /conversations/:id/read`
- **`ChatPage.tsx`** — `handleSelectConversation` chama `markAsRead` fire-and-forget ao selecionar conversa

#### Backend — Delivery / read status em tempo real (✓✓ ticks)

- **`BaileysMessagingEngineAdapter`** — novo handler `messages.update`: detecta acks de mensagens enviadas (`key.fromMe === true`); status 3 → `MESSAGE_DELIVERED`, status 4/5 → `MESSAGE_READ`
- **`IChatMessageRepository`** — novo método `updateStatusByExternalId(externalId, tenantId, status)`
- **`PrismaChatMessageRepository`** — implementação: busca por `externalMessageId` + atualiza `status`
- **`ChatMessageStatusListener.ts`** (novo) — ouve `MESSAGE_DELIVERED` e `MESSAGE_READ` no event bus; atualiza status no DB; publica `chat.message.status.updated` via WebSocket
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.message.status.updated` com `{ conversationId, messageId, status }`
- **`server.ts`** — `registerChatMessageStatusListener(chatMessageRepo)` no startup

#### Backend — Engine singleton compartilhado

- **`activeEngine.ts`** (novo) — `setActiveEngine()` / `getActiveEngine()` para compartilhar a instância entre módulos sem acoplamento direto
- **`session.routes.ts`** — chama `setActiveEngine()` após criação da engine

#### Frontend — Status de mensagens em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsMessageStatusUpdatedData` e evento `chat.message.status.updated` no union `ChatWsPayload`
- **`ChatPage.tsx`** — handler `chat.message.status.updated`: localiza a mensagem pelo `messageId` no estado e atualiza `status` → `MessageBubble` renderiza o tick correto (✓ sent → ✓✓ delivered → ✓✓ azul read)

### Fixed

- **`BaileysMessagingEngineAdapter`** — `messaging-history.set` handler corrigido: antes fazia `histMsgs.map(h => h.message)` que stripava a `key` e descartava tudo; agora passa `histMsgs` direto
- **`BaileysMessagingEngineAdapter`** — `messages.upsert` não mais ignora mensagens `fromMe` (antes tinha `if (msg.key.fromMe) continue`)
- **`markMessagesRead`** — corrigido risco de JID duplicado (`@s.whatsapp.net@s.whatsapp.net`) usando `normalizeJid()` em vez de concatenação direta
- **`vite.config.ts`** — adicionado `ws: true` no proxy `/api` para que conexões WebSocket passem pelo Vite em dev

### Changed

- `IngestIncomingMessageUseCase` — aceita `fromMe` no input; lógica de direction e unread condicional
- `InternalMessagingEvent` — adicionados tipos `MESSAGE_READ` e campo `fromMe` em `MESSAGE_RECEIVED`
- `MessagingEngineFactory` — aceita `chatContactRepo` e `ingestHistorySyncUseCase` como dependências para injeção no adapter

---

## [0.6.0] — 2026-03-10 — Chat V3: WebSocket em tempo real + deduplicação de mensagens

### Added

#### Backend — WebSocket gateway

- **`@fastify/websocket@8.3.1`** instalado (compatível com Fastify v4; v11 exigia Fastify v5)
- **`ws@8.x`** e **`@types/ws`** adicionados como dependências
- **`app.ts`** — `await app.register(websocket)` registrado após o plugin JWT
- **`chat.ws.routes.ts`** (novo) — gateway WebSocket em `GET /api/chat/ws?token=&tenantId=`; autentica via `sseAuthHook` (mesma lógica do SSE); registra/desregistra cliente no `ChatWebSocketPublisher`; keepalive JSON ping a cada 25 s; limpa timer e desregistra ao fechar
- **`routes.ts`** — `chatWsRoutes` registrado sob `/api/chat` após as rotas REST

#### Backend — ChatWebSocketPublisher

- **`ChatWebSocketPublisher.ts`** (novo) — singleton (`chatWsPublisher`) que mantém `Map<tenantId, Set<WebSocket>>`; métodos `subscribe`, `unsubscribe`, `publish`, `pingAll`; remove automaticamente clientes mortos no `publish`
- **`ChatWsEvent`** — union type discriminado com quatro eventos: `chat.message.created`, `chat.conversation.updated`, `chat.unread.updated`, `chat.session.updated`; campo `event: 'ping'` para keepalive

#### Backend — deduplicação de mensagens inbound

- **`IChatMessageRepository`** — adicionado método `findByExternalId(externalId, tenantId): Promise<ChatMessage | null>`
- **`PrismaChatMessageRepository`** — implementação: `prisma.chatMessage.findFirst({ where: { externalMessageId, tenantId } })`
- **`IngestIncomingMessageUseCase`** — step 3 de deduplicação: se `externalMessageId` já existir no banco, retorna `null` sem duplicar; use case agora retorna `IngestIncomingMessageResult | null` com `{ conversationId, message, isNewConversation, unreadCount }` em vez de `void`

#### Backend — publicação automática via WS

- **`ChatIncomingMessageListener`** — após ingestão bem-sucedida, publica `chat.message.created` + `chat.unread.updated` via `chatWsPublisher`; se resultado for `null` (duplicata), ignora silenciosamente
- **`chat.routes.ts`** — handler `PATCH /conversations/:id` publica `chat.conversation.updated` via `chatWsPublisher` após atualizar a conversa

#### Frontend — hook WebSocket

- **`useChatWebSocket.ts`** (novo) — hook React com reconexão automática (backoff exponencial 2 s → 30 s); constrói URL `ws://` a partir de `VITE_API_URL` (compatível com proxy Vite em dev e URL absoluta em produção); tipagem completa de `ChatWsPayload`
- `WsMessageCreatedData`, `WsConversationUpdatedData`, `WsUnreadUpdatedData`, `WsSessionUpdatedData` — interfaces tipadas espelhando `ChatWsEvent` do backend

#### Frontend — ChatPage integrado com WebSocket

- **`ChatPage.tsx`** — substituído `useChatSSE` por `useChatWebSocket`; tratamento diferenciado por evento:
  - `chat.message.created` com `isNewConversation=true` → recarrega lista completa (nova conversa ainda não no estado)
  - `chat.message.created` com conversa já existente → atualiza preview inline no estado sem refetch
  - `chat.message.created` com conversa aberta → insere mensagem diretamente no `messages[id]` sem HTTP
  - `chat.conversation.updated` → atualiza campos da conversa inline
  - `chat.unread.updated` → atualiza badge de não lidos inline

### Fixed

- **`chat.ws.routes.ts`** — assinatura do handler corrigida para `@fastify/websocket` v8: recebe `connection: SocketStream` (com `connection.socket: WebSocket`), não o `WebSocket` diretamente como na v11

### Changed

- `IngestIncomingMessageUseCase.execute()` — assinatura alterada de `Promise<void>` para `Promise<IngestIncomingMessageResult | null>`; `ChatIncomingMessageListener` atualizado correspondentemente

### Tested

- `tsc --noEmit` (api/) — zero erros
- `tsc --noEmit` (app/) — zero erros
- Handshake WebSocket autenticado — `WS CONNECTED OK`
- End-to-end: PATCH conversa → evento `chat.conversation.updated` recebido via WS em < 400 ms
- 2 PATCHes consecutivos → 2 eventos WS independentes entregues (`[PASS] WS sync OK`)
- Baileys conectado e online (`AwaitingInitialSync → Online`) durante os testes

---

## [0.5.0] — 2026-03-10 — Chat V2: ingestão de mensagens WhatsApp em tempo real + SSE

### Added

#### Backend — pipeline de ingestão

- **`InternalMessagingEvent`** — `MESSAGE_RECEIVED` enriquecido com campos `fromName?: string` e `externalMessageId?: string`
- **`IChatConversationRepository`** — novo método `findActiveByContactAndSession(contactId, sessionId, tenantId)` — localiza conversa não-CLOSED para o par contato+sessão
- **`PrismaChatConversationRepository`** — implementação: `status: { notIn: ['CLOSED'] }`, ordenado por `lastMessageAt desc`
- **`IngestIncomingMessageUseCase`** (novo) — orquestra: findOrCreate contato → findActive ou cria conversa → persiste mensagem → atualiza preview + incrementa não lidos
- **`BaileysMessagingEngineAdapter`** — handler `messages.upsert` com `type === 'notify'`: extrai `from`, `body`, `externalMessageId` (key.id), `pushName`; emite `MESSAGE_RECEIVED` no event bus interno
- **`ChatIncomingMessageListener`** (novo) — subscreve `MESSAGE_RECEIVED` no event bus; delega ao `IngestIncomingMessageUseCase`; loga erros sem crashar
- **`server.ts`** — instancia repositórios de chat, `IngestIncomingMessageUseCase` e registra o listener no startup

#### Backend — SSE (Server-Sent Events)

- **`sseAuthHook.ts`** (novo) — preHandler que lê `?token=` e `?tenantId=` da query string, injeta no header `Authorization` e chama `jwtVerify`; resolve tenant context (incluindo super-admin)
- **`chat.routes.ts`** — endpoint `GET /api/chat/events` (SSE): emite `event: message_received` para clientes do tenant; keepalive `:ping` a cada 25 s; desregistra listener ao fechar

#### Frontend — integração SSE

- **`useChatSSE.ts`** (novo) — hook com `EventSource`, lê `?token=` e `?tenantId=` do localStorage; reconexão automática com backoff exponencial (2 s → 30 s)
- **`ChatPage.tsx`** — integrado `useChatSSE`; recarrega lista de conversas e mensagens da conversa aberta ao receber `message_received`

### Tested

- `tsc --noEmit` (api/) — zero erros
- `tsc --noEmit` (app/) — zero erros
- Ingestão verificada via curl (mensagens armazenadas no banco com contato e conversa criados automaticamente)

---

## [0.4.0] — 2026-03-09 — Redesign SaaS do painel + correções de QR e persistência de sessão de usuário

### Added

#### Tema global — dark/light mode

- **`buildTheme(mode: PaletteMode)`** — factory de tema MUI substituindo o export estático anterior; suporta alternância claro/escuro em runtime
- Paleta nova: `primary #4f70e0`, `secondary #7c3aed`; dark: `background.default #0f1117`, `paper #1a1d27`; light: `background.default #f4f6fb`, `paper #ffffff`
- Overrides de componentes MUI: `Button`, `Card`, `Drawer`, `AppBar`, `TextField`, `Chip`, `ListItemButton`, `Dialog`, `IconButton`, `Alert`, `Tooltip`; scroll global customizado

#### ThemeContext — persistência do tema

- **`src/contexts/ThemeContext.tsx`** — `ColorModeProvider` com hook `useColorMode()`; modo persiste em `localStorage.colorMode`; `App.tsx` atualizado para usar `ColorModeProvider` em vez de `ThemeProvider` direto

#### Componentes reutilizáveis — `src/components/`

- **`PageHeader.tsx`** — cabeçalho de página: `{ title, subtitle, action, sx }`; flex layout responsivo
- **`StatCard.tsx`** — cartão de métrica: `{ label, value, icon, accentColor }`; barra lateral de acento colorido + caixa de ícone
- **`EmptyState.tsx`** — estado vazio com borda tracejada: `{ icon, title, description, action }`
- **`SectionCard.tsx`** — card com header e divisor: `{ title, subtitle, action, children, noPadding }`
- **`src/components/index.ts`** — barrel export dos quatro componentes

#### AppLayout — sidebar SaaS

- Reescrito com `DRAWER_WIDTH=248`; componente `NavLogo` com ícone "W" gradiente; seção "EM BREVE" com itens desabilitados (Contatos, Campanhas, Flows, Automação, Assistentes, Métricas) e `<Chip label="Em breve" />` inline
- Botão de toggle claro/escuro na topbar; chip do tenant ativo; bloco inferior da sidebar exibe **e-mail** e **papel** do usuário (`Super Admin` / `Usuário`)

#### LoginPage — layout split-panel

- Reescrita com painel esquerdo (gradiente `primary.dark → secondary.main`) contendo logo, lista de features da plataforma e círculos decorativos; painel direito com formulário de login
- toggle de tema no canto superior direito; painel esquerdo oculto em `xs/sm` (responsivo); card de credenciais de desenvolvimento exibido só em `IS_DEV`

#### DashboardPage — visão geral operacional

- Reescrita com saudação por horário (Bom dia / Boa tarde / Boa noite), chip do tenant ativo, 4 `StatCard` com cores de acento (total/conectadas/aguardando/com problemas)
- `SectionCard` com preview das 5 sessões mais recentes (dot de status + nome + telefone) e botão "Gerenciar"
- `SectionCard` com lista dos próximos módulos (Chatbots, Flows visuais, Campanhas, Assistentes IA, Métricas)

#### SessionsPage

- Atualizada para usar `PageHeader` + `EmptyState` dos componentes reutilizáveis; lógica de negócio intacta

#### SessionCard — card moderno

- Reescrito: avatar com inicial + dot de status (verde/amarelo/vermelho/cinza) posicionado no canto inferior-direito do avatar
- `SessionStatusChip` inline; linha com ícone de telefone + número; data formatada de `updatedAt`
- Efeito hover: `border-color alpha(primary, 0.35)` + `box-shadow`; ações separadas em grupo esquerdo (connect/disconnect/reconnect/logout como `IconButton`) e grupo direito (QR + delete)

#### QrCodeDialog — modal refinado

- Reescrito: sem `DialogTitle` — header customizado com nome da sessão, `SessionStatusChip`, botão de refresh e close
- Frame do QR: `border 2px solid alpha(primary, 0.4)` + `boxShadow` de glow; fundo sempre branco para o QR
- Dot animado com `@keyframes pulse` (opacidade 1→0.3→1 a 1,5s) indicando polling ativo

### Fixed

#### QR — renderização correta

- Instalado `qrcode.react`; tela de QR substituída de `<img src={qrCode}>` (que não renderizava string raw do Baileys) para `<QRCodeSVG value={qrCode} />` — QR agora scaneável corretamente

#### QR — loop infinito de polling

- **Causa raiz:** callback `onStatusChange` criava novo objeto `{ ...prev, status }` → referência de `session` mudava → `useEffect([session])` disparava novamente → novo `setInterval` → loop exponencial
- **Correção 1** (`QrCodeDialog`): dependência trocada de `session` (objeto) para `session?.id` (string primitiva); `fetchStateRef` para evitar stale closure no intervalo; cleanup ao fechar o dialog
- **Correção 2** (`SessionsPage`): `handleStatusChange` memoizado com `useCallback` para estabilizar referência entre re-renders

#### Persistência do usuário após reload

- **Causa:** `loadInitialState` em `AuthContext` só restaurava `accessToken` do `localStorage`; `user` voltava como `null` após qualquer reload, quebrando a exibição de e-mail/papel na sidebar
- **Correção:** objeto `user` serializado em `localStorage.authUser` no login; restaurado no `loadInitialState`; removido no logout

### Tested

- `tsc --noEmit` (app/) — zero erros de tipagem
- Smoke test manual no browser:
  - Login → token e dados do usuário persistidos corretamente (e-mail e papel exibidos na sidebar após reload)
  - Toggle claro/escuro → persist no localStorage, aplicado imediatamente em toda a UI
  - Dashboard → StatCards renderizando totais corretos de sessões; preview de sessões ativas listando corretamente
  - Sessões → `SessionCard` com dot de status correto; ações de connect/disconnect/reconnect/logout funcionando
  - QR dialog → QR code renderiza e é scaneável; polling a cada 5 s sem loops; indicador de pulse visível durante atualização
  - Responsividade verificada (painel esquerdo do login oculto em telas menores)

---

## [0.3.0] — 2026-03-09 — OpenAPI 3.0 / Swagger UI

### Added

#### Dependências

- **`@fastify/swagger@8.15.0`** — geração automática de spec OpenAPI 3.0.3 a partir dos schemas das rotas; versão 8.x compatível com Fastify v4
- **`@fastify/swagger-ui@4.2.0`** — interface Swagger UI servida em `GET /docs`

#### Spec OpenAPI

- Título, versão (0.3.0), descrição e contato cadastrados em `openapi.info`
- Dois servidores declarados: `http://localhost:<PORT>` (local) e `https://waioprime-api.onrender.com` (produção)
- Security scheme **`bearerAuth`** (HTTP Bearer JWT) configurado globalmente; bearer obtido via `POST /api/auth/login`
- Tags declaradas: `Health`, `Auth`, `Tenants`, `Me`, `Sessions`

#### Schemas compartilhados — `app.addSchema()`

Todos registrados via `addSchema()` para reuso por `$ref` em todas as rotas:

- **`LoginResponse`** — objeto com `success`, `data.accessToken`, `data.refreshToken`, `data.user`, `data.tenants`
- **`TenantItem`** — objeto com `id`, `name`, `slug`, `role` (enum OWNER/ADMIN/MEMBER/SUPER_ADMIN), `status`
- **`SessionStatus`** — enum dos 8 estados possíveis de sessão
- **`SessionItem`** — objeto completo de sessão com todos os campos
- **`ErrorResponse`** — objeto `{ success: false, error: { code, message } }`

#### Anotações por rota

Todas as rotas receberam `schema: { tags, summary, description?, security?, headers?, body?, params?, response }`:

- **`GET /health`** — tag Health; response 200 com `status`, `timestamp`, `environment`
- **`POST /api/auth/login`** — body existente reaproveitado; response 200 `LoginResponse`, 401 `ErrorResponse`
- **`POST /api/auth/refresh`** — response 200 `{ accessToken }`, 401 `ErrorResponse`
- **`POST /api/auth/logout`** — `security: [bearerAuth]`; response 204, 401 `ErrorResponse`
- **`GET /api/tenants`** — `security: [bearerAuth]`; response 200 array de `TenantItem`
- **`POST /api/tenants/switch`** — `security: [bearerAuth]`; response 200 `{ accessToken, tenantId, tenantName }`
- **`GET /api/me`** — `security: [bearerAuth]`; response 200 com perfil completo e tenants
- **10 rotas de sessions** — todas com `security: [bearerAuth]`, header `x-tenant-id` obrigatório, params `sessionIdParamSchema` quando aplicável, responses tipados por rota:
  - `POST /api/sessions` → 201 `SessionItem`
  - `GET /api/sessions` → 200 `{ sessions: SessionItem[], total }`
  - `GET /api/sessions/:id` → 200 `SessionItem`
  - `GET /api/sessions/:id/status` → 200 `{ sessionId, status, phone, lastConnectedAt, lastDisconnectedAt }`
  - `POST /api/sessions/:id/connect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/disconnect` → 200 `{ sessionId, status }`
  - `POST /api/sessions/:id/reconnect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/logout` → 200 `{ sessionId, status }`
  - `GET /api/sessions/:id/qr` → 200 `{ sessionId, qrCode }`
  - `GET /api/sessions/:id/pairing-code` → 200 `{ sessionId, pairingCode }`

#### Swagger UI

- Servido em `GET /docs` (sem autenticação)
- `docExpansion: 'list'`, `deepLinking: true`, `persistAuthorization: true`

#### CORS

- `allowedHeaders` atualizado para incluir `x-tenant-id`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Servidor sobe sem erros (`pnpm run dev`)
- `GET /docs` retorna `200 OK` com a interface Swagger UI
- spec JSON disponível em `GET /docs/json`

---

## [0.2.0] — 2026-03-09 — Integração real do Baileys ao módulo de sessions

### Added

#### Baileys — infra da engine de mensageria

- **`@whiskeysockets/baileys@7.0.0-rc.9`** instalado via npm (inclui `lib/` pré-compilado; build scripts de `postinstall` ignorados pelo pnpm por segurança — comportamento esperado)
- **`BaileysAuthStatePersistence.ts`** — implementação de `AuthenticationState` com persistência em banco (tabela `SessionAuthState`); substitui `useMultiFileAuthState`:
  - armazena credenciais e chaves Signal em um único blob JSON por sessão (`statePayload`)
  - serialização via `BufferJSON.replacer/reviver` para roundtrip correto de `Buffer`/`Uint8Array`
  - chaves de tipo `app-state-sync-key` deserializadas via `proto.Message.AppStateSyncKeyData.fromObject()`
- **`BaileysSessionRegistry.ts`** — registro em memória de conexões `WASocket` ativas; singleton compartilhado pelo processo:
  - `ActiveSessionEntry { socket, tenantId, latestQr?, latestPairingCode? }`
  - métodos: `set / get / has / delete / setQr / clearQr / setPairingCode / getQr / getPairingCode / getAll()`
- **`BaileysErrorTranslator.ts`** — tradução de erros e motivos de desconexão Baileys para `AppError` internos:
  - `translateDisconnect(sessionId, lastError)` retorna `{ shouldReconnect, error }` para cada `DisconnectReason`
  - `translateEngineError(err)` para erros genéricos de socket
  - duck-typing sobre `Boom` (sem dependência direta de `@hapi/boom`)

#### BaileysMessagingEngineAdapter — implementação completa

- Substituído stub anterior pela implementação real de `IMessagingEngine`:
  - **`connectSession`** — abre socket Baileys com versão WA buscada via `fetchLatestBaileysVersion()`, auth de banco via `BaileysAuthStatePersistence`, browser fingerprint `Browsers.ubuntu('Chrome')`
  - **`disconnectSession`** — fecha socket, remove do registry, atualiza status `DISCONNECTED`
  - **`reconnectSession`** — delega para `connectSession` (reabre socket com credenciais persistidas)
  - **`logoutSession`** — executa `socket.logout()` + fecha socket + atualiza status `LOGGED_OUT`; credenciais limpos pelo use case
  - **`getSessionStatus`** — inspeciona `ws.readyState` do socket ativo
  - **`getSessionQr`** — lê QR code em memória do registry
  - **`getSessionPairingCode`** — lê pairing code em memória do registry
  - **Reconexão automática com backoff exponencial**: base 3s, máximo 5 tentativas; falha permanente → status `FAILED`
  - Emite todos os eventos internos: `SESSION_CONNECTING`, `SESSION_CONNECTED`, `SESSION_DISCONNECTED`, `SESSION_QR_UPDATED`, `SESSION_LOGGED_OUT`

#### Schema e domínio

- **`SessionStatus`** — adicionados dois novos estados:
  - `AWAITING_QR` — socket aberto aguardando scan do QR
  - `AWAITING_PAIRING` — aguardando código de pareamento
- **Migration** `20260309185659_add_session_awaiting_states` aplicada e versionada
- **`Session.canDisconnect()`** atualizado: inclui `AWAITING_QR` e `AWAITING_PAIRING` como estados desconectáveis

#### IMessagingEngine — novos tipos e métodos

- Interfaces de input explícitas: `ConnectSessionInput`, `DisconnectSessionInput`, `ReconnectSessionInput`, `LogoutSessionInput` (todas com `tenantId`)
- Novos métodos no contrato: `getSessionQr(sessionId)` e `getSessionPairingCode(sessionId)`
- `MessagingEngineFactory.create()` agora recebe `sessionRepo` e `authStateRepo` como parâmetros

#### ISessionRepository — método de bootstrap

- **`findActiveSessionsForBootstrap()`** — retorna todas as sessões (cross-tenant) com status em `CONNECTING | AWAITING_QR | AWAITING_PAIRING | CONNECTED`; usado somente no startup para reconectar sessões ativas

#### Use Cases — integração com engine real

- **`ConnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.connectSession()` após atualizar status para `CONNECTING`
- **`DisconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.disconnectSession()` antes de atualizar status
- **`ReconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.reconnectSession()`
- **`LogoutSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.logoutSession()` + limpa `SessionAuthState`

#### Novos Use Cases

- **`GetSessionQrUseCase`** — valida tenant ownership, delega para `engine.getSessionQr()`
- **`GetSessionPairingCodeUseCase`** — valida tenant ownership, delega para `engine.getSessionPairingCode()`

#### SessionBootstrapService

- **`SessionBootstrapService`** — serviço de startup: consulta sessões ativas no banco e chama `engine.reconnectSession()` para cada uma em paralelo (`Promise.allSettled`); falhas individuais são logadas e a sessão é marcada `DISCONNECTED`, sem bloquear o boot

#### Presentation

- **`SessionPresenter`** — adicionados `toQrResult()` e `toPairingCodeResult()`
- **`session.routes.ts`** — engine singleton instanciado via `MessagingEngineFactory`; 2 novas rotas:
  - `GET /api/sessions/:id/qr` — retorna QR code atual (ou `null`)
  - `GET /api/sessions/:id/pairing-code` — retorna pairing code atual (ou `null`)
- **`server.ts`** — chama `SessionBootstrapService.bootstrap()` após o servidor iniciar; falha do bootstrap não derruba o processo

### Changed

- `api/prisma/schema.prisma` — enum `SessionStatus` com 2 novos valores
- `api/package.json` — dependência `@whiskeysockets/baileys@7.0.0-rc.9` adicionada; `package-lock.json` substituído por `pnpm-lock.yaml`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Smoke test manual end-to-end:
  - `POST /api/auth/login` → token OK
  - `POST /api/sessions` → sessão criada com status `PENDING`
  - `POST /api/sessions/:id/connect` → status muda para `CONNECTING`
  - `GET /api/sessions/:id/status` (após ~8s) → status `AWAITING_QR`
  - `GET /api/sessions/:id/qr` → QR code string retornado corretamente

---

## [0.1.0] — 2026-03-09 — Módulo de sessions com ciclo de vida completo (commit 2ef19eb)

### Added

#### Módulo de Sessions — ciclo de vida completo

- **Schema Prisma** — adicionados campos ao model `Session`:
  - `engine String @default("baileys")` — engine de mensageria da sessão
  - `externalRef String?` — referência externa fornecida pela engine
  - `lastConnectedAt DateTime?` — última conexão confirmada
  - `lastDisconnectedAt DateTime?` — última desconexão/logout
  - `deletedAt DateTime?` — soft delete
- **Schema Prisma** — model `SessionAuthState` revisado:
  - campo `data Json` renomeado para `statePayload Json`
  - adicionados `tenantId String`, `provider String @default("baileys")`, `version Int @default(0)`
  - adicionada relação com `Tenant` e índice em `tenantId`
- **Migration** `20260309175545_add_session_lifecycle_fields` aplicada e versionada

#### Domain

- **`Session.ts`** — entidade atualizada com 6 novos campos e métodos de máquina de estados:
  - `canConnect()` — PENDING | DISCONNECTED | FAILED → CONNECTING
  - `canDisconnect()` — CONNECTED | CONNECTING → DISCONNECTED
  - `canReconnect()` — DISCONNECTED | FAILED | LOGGED_OUT → CONNECTING
  - `isDeleted()` — suporte a soft delete
- **`ISessionRepository.ts`** — contratos revisados com interfaces explícitas `SessionCreateData` e `SessionStatusUpdate`
- **`ISessionAuthStateRepository.ts`** — novo contrato de persistência do estado de autenticação da engine

#### Shared — Audit

- **`IAuditLogRepository.ts`** — contrato de auditoria com tipo `AuditAction` desacoplado do Prisma
- **`PrismaAuditLogRepository.ts`** — implementação via `prisma.auditLog.create()`

#### Application — DTOs e Use Cases

- **`SessionDto.ts`** — DTOs explícitos: `CreateSessionInputDto`, `SessionItemDto`, `SessionStatusDto`, `SessionActionDto` (com `qrCode?` e `pairingCode?` reservados para integração com engine)
- **`CreateSessionUseCase`** — cria sessão em estado `PENDING`, audita `SESSION_CREATED`
- **`ListSessionsUseCase`** — lista sessões ativas do tenant
- **`GetSessionByIdUseCase`** — busca sessão por id com isolamento de tenant
- **`GetSessionStatusUseCase`** — retorna status resumido da sessão
- **`ConnectSessionUseCase`** — valida `canConnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED`; placeholder para `IMessagingEngine.connectSession()`
- **`DisconnectSessionUseCase`** — valida `canDisconnect()`, muda para `DISCONNECTED`, registra `lastDisconnectedAt`, audita `SESSION_DISCONNECTED`; placeholder para engine
- **`ReconnectSessionUseCase`** — valida `canReconnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED` com `meta.action = reconnect_requested`; placeholder para engine
- **`LogoutSessionUseCase`** — muda para `LOGGED_OUT`, limpa `SessionAuthState` via repositório, audita `SESSION_LOGGED_OUT`; placeholder para engine

#### Infrastructure

- **`PrismaSessionMapper.ts`** — converte `PrismaSession` → `Session` (domínio)
- **`PrismaSessionRepository.ts`** — implementação com padrão `updateMany({ where: {id, tenantId} })` para isolamento de tenant em nível de banco (defense-in-depth); `findById` usa `deletedAt: null`
- **`PrismaSessionAuthStateRepository.ts`** — upsert com incremento de `version`; `deleteMany` no logout

#### Presentation

- **`SessionPresenter.ts`** — transforma outputs dos use cases em respostas HTTP (`toSessionItem`, `toSessionList`, `toSessionStatus`, `toConnectResult`, `toActionResult`)
- **`session.schema.ts`** — schemas de validação JSON Schema para Fastify (`createSessionBodySchema`, `sessionIdParamSchema`)
- **`session.routes.ts`** — 8 rotas registradas, todas com `preHandler: [authHook, tenantHook]`:
  - `POST /api/sessions` — cria sessão
  - `GET /api/sessions` — lista sessões do tenant
  - `GET /api/sessions/:id` — detalhe da sessão
  - `GET /api/sessions/:id/status` — status resumido
  - `POST /api/sessions/:id/connect` — solicita conexão
  - `POST /api/sessions/:id/disconnect` — solicita desconexão
  - `POST /api/sessions/:id/reconnect` — solicita reconexão
  - `POST /api/sessions/:id/logout` — logout e limpeza de credenciais
- **`routes.ts`** — registradas as rotas de sessions em `${API_PREFIX}/sessions`

### Changed

- `api/src/app/routes.ts` — importa e registra `sessionRoutes`
- `api/prisma/schema.prisma` — modelos `Session`, `SessionAuthState` e `Tenant` atualizados

### Fixed

- Padrão `updateMany` no repositório de sessões contorna limitação do Prisma (`update` só aceita campos únicos no `where`), garantindo isolamento de tenant em todas as mutações

---

## [0.1.0] — 2026-03-09 — Commit inicial

### Added

- Estrutura inicial do monorepo (`api/`, `app/`, `panel/`, `scripts/`)
- Base da API com **Fastify + TypeScript + Prisma + PostgreSQL**
- Configuração centralizada com `dotenv`
- Logger estruturado (`pino`)
- Tratamento global de erros e healthcheck (`GET /health`)
- Módulo de **autenticação** (login, access token, refresh token)
- Módulo de **tenants** (criação, listagem, gerenciamento)
- Módulo de **usuários** (me, update)
- Multi-tenancy com `tenantHook` e `authHook`
- Schema Prisma inicial com entidades: `Tenant`, `User`, `UserTenant`, `Session`, `SessionAuthState`, `Message`, `Contact`, `AuditLog`
- Migrations versionadas
- Seed de dados iniciais
