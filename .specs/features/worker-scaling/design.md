# Design — Gestão de escala dos workers

**Spec:** [`spec.md`](spec.md) · **Status:** Draft

## 1. Visão geral

```
painel /admin/workers/{settings,capacity,scale}
        │ PUT/GET/POST (super admin)
        ▼
API (qualquer papel) ── platform_settings["worker_scaling"] ◄── refresh 30 s ── todo processo
        │                                                              │
        │ POST /scale                                  provider.current() (síncrono)
        ▼                                                              ▼
 ScaleWorkersUseCase ── IWorkerScaler ── Render API     gate do lease · adoção · heartbeat · alerta
        │
        ▼
 worker_scale_events ◄── WorkerAutoscalerJob (lease, tick 60 s) ◄── ops_metrics_samples (sessions_*)
                                                                          ▲
                                              OpsMetricsSamplerJob ── SessionsOccupancySource (conta no banco)
```

A fonte da verdade é o banco. O cache do provider é derivado e descartável (cache de desempenho, aceito por
`docs/arquitetura-escala.md` §6). **Boot degradado:** se a primeira leitura falhar, o processo sobe com os valores da env
(os mesmos de hoje), loga `warn` e troca no primeiro refresh que der certo.

## 2. Reuso

| Peça | Onde | Como |
| --- | --- | --- |
| `PlatformSetting` | `api/prisma/schema.prisma:948-955` | Chave `worker_scaling`; sem migration para a configuração |
| Padrão de leitura/gravação | `assistants/infrastructure/repositories/PrismaAiSettingsRepository.ts` | Mesma tabela e injeção do `PrismaClient`; ele faz `upsert` cego, então a concorrência por `updatedAt` (`schema.prisma:951-952`, já existem) é código novo |
| Auditoria sem tenant | `tenants/application/use-cases/SetPlanEntitlementUseCase.ts:46` | `audit.create({ userId, action, meta })` |
| Limites do gate | `sessions/application/services/CapacityLimitedLeaseGate.ts:68` (construtor), usos em `:129-137` | Trocar `limits` fixo por função `() => limits` |
| Composição | `sessions/infrastructure/lease/sessionLeaseContainer.ts:45-47`, `sessionAdoptionContainer.ts:55-78, 89-111`, `app/roleComposition.ts:83,98` (fila `session-open`) | Injetar o provider; nenhum consumidor guarda o número |
| Política pura | `sessions/domain/services/sessionAdoptionPolicy.ts:23,26,62-63` | **Mudança de assinatura** (não reuso): `capacityAlertReason` hoje usa constantes; passa a receber ratio e segundos |
| Coletor | `metrics/infrastructure/jobs/OpsMetricsSamplerJob.ts:176` | Fonte nova no array `sources` |
| Cliente Render | `metrics/infrastructure/sources/RenderPlatformMetricsSource.ts:92-141` | Mesmo padrão: `fetchFn` injetável, `AbortSignal.timeout`, chave nunca logada |
| Job por papel | `app/processJobs.ts`, `shared/jobs/IJobLease.ts` | `workerAutoscaler` em `WORKER_JOBS` |
| Tela | `pages/admin/AdminWorkersPage.tsx:247-280` | Abas pela URL; hoje ternário de duas abas com `Tabs` `fullWidth`: vira mapa caminho→aba, `variant="scrollable"`; novas abas em chunks `lazy` |
| Tela que edita | `pages/admin/AdminPlanEntitlementsPage.tsx`, `features/planEntitlementsAdmin/` | Atualização só após a API, `Snackbar`. `ConfirmDialog` só aceita texto: diff, confirmação reforçada e motivo usam diálogo próprio da feature |
| Contagem regressiva | `components/CooldownBar.tsx` + `services/serverClock.ts` | Intervalo mínimo entre escaladas |
| Cursor | `shared/http/pagination/OpaqueCursor.ts` | Histórico de eventos |

## 3. Componentes

### Backend (`api/src/modules/sessions/` salvo indicação)

| Componente | Camada | Responsabilidade |
| --- | --- | --- |
| `WorkerScalingSettings` + `parseWorkerScalingSettings` + `resolveEffectiveSettings(saved, envDefaults)` | `domain/services/workerScalingSettings.ts` | Faixas, defaults, origem por campo. Função pura |
| `IWorkerScalingSettingsRepository` (`get`, `save(expectedUpdatedAt)`) | `domain/contracts` | Contrato |
| `PrismaWorkerScalingSettingsRepository` | `infrastructure/repositories` | `platform_settings`; `save` com `updateMany where updatedAt` (409 se 0 linhas) ou `create` |
| `IWorkerScalingSettingsProvider` / `RefreshingWorkerScalingSettingsProvider` | `domain/contracts` / `infrastructure/lease` | `current()`, `refresh()`, `start()/stop()`; último valor bom |
| `GetWorkerScalingSettingsUseCase`, `UpdateWorkerScalingSettingsUseCase` | `application/use-cases` | Leitura com origem; validação, gravação, auditoria, `provider.refresh()` |
| `capacityPlan` (`requiredReplicas`, `mbPerSession`, `suggestedMaxSessions`, `canScaleDownTo`, `shouldScaleUp`) | `domain/services/capacityPlan.ts` | Contas puras da previsão e das regras de escala |
| `IWorkerCapacityReader` / `PrismaWorkerCapacityReader` | contrato / repositório | SQL agregado por plano (entitlements + sessões), tenants `ACTIVE`, `statement_timeout` 2 s |
| `GetWorkerCapacityUseCase` | `application/use-cases` | Junta leitor, configuração e última amostra |
| `SessionsOccupancySource` | `metrics/infrastructure/sources` | `sessions_connected/pending_login/awaiting/capacity` |
| `IWorkerScaler` / `RenderWorkerScaler` / `NotConfiguredWorkerScaler` | contrato / `infrastructure/scaler` | Estado e `scaleTo`; tradução de erro (`SCALER_NOT_CONFIGURED`, `SCALER_UNAVAILABLE`, `SCALER_RATE_LIMITED`) |
| `IWorkerScaleEventRepository` / `PrismaWorkerScaleEventRepository` | contrato / repositório | Gravar, listar por cursor, último sucesso, limpeza de 180 dias em lote |
| `ScaleWorkersUseCase` | `application/use-cases` | Regras de WSCALE-12, evento antes e depois da chamada, idempotência por `requestId` |
| `WorkerAutoscalerJob` | `infrastructure/jobs` | WSCALE-15/16; chama o mesmo use case com `trigger=auto` |
| `workerAdmin.routes.ts` (+ schema, presenter) | `presentation` | Rotas novas sob `/admin/workers`, handlers finos |

### Painel (`app/src/features/workersAdmin/`)

| Componente | Responsabilidade |
| --- | --- |
| `types.ts`, `strings.ts` | Contratos e textos (pt-BR, sem marca) |
| `rules.ts` | `validateSettingsDraft`, `diffSettings`, `clientsThatFit(plan, headroom)`, estados do escalador |
| `app/src/services/adminWorkers.service.ts` (fora da feature) | `getSettings`, `updateSettings`, `getCapacity`, `getScaleState`, `scale`, `listScaleEvents` |
| `components/SettingsTab.tsx` + `useWorkerSettings.ts` | Formulário, confirmação, rascunho persistido |
| `components/CapacityTab.tsx` + `useWorkerCapacity.ts` | Cartões, tabela por plano, série (reusa `opsMetrics/components/TimeLineChart`) |
| `components/ScaleTab.tsx` + `useWorkerScale.ts` | Estado, ações, `CooldownBar`, histórico |

Sem flag de privacidade: nenhum dado de cliente (só contagens por plano) e o histórico de escala não mostra nome nem
e-mail do ator (só `Manual`/`Automática`; a API não devolve `actorUserId`, quem pediu fica na auditoria). Registrar isso no doc.

## 4. Dados

- **Configuração:** `platform_settings.key = 'worker_scaling'`, `value` = JSON de WSCALE-01. Sem migration.
- **`worker_scale_events`** (migration `create_worker_scale_events`): `id` BigInt autoincremento (como `ops_metrics_samples`), `at timestamp default now() UTC`,
  `trigger text`, `actorUserId text null` (`User.id` é cuid, `schema.prisma:202`), `fromReplicas int`, `toReplicas int`, `reason text` (≤ 200),
  `outcome text`, `error text null` (≤ 200), `requestId text unique null`. Índice `(at desc)`.
- **`AuditAction`** (migration `add_audit_action_worker_scaling`): `WORKER_SCALING_SETTINGS_CHANGED`,
  `WORKER_SCALE_REQUESTED`. Atualizar a união em `shared/audit/IAuditLogRepository.ts`.
- **`OPS_METRIC`:** quatro gauges `sessions_*`, fonte `sessions`. Sem migration (coluna `metric` é texto).
- **P5:** `worker_heartbeats.drainRequestedAt timestamp null` (migration própria); o upsert do batimento não toca a coluna.

Contagens (relógio `now() AT TIME ZONE 'UTC'`):
- `connected`: sessões com `leaseUntil` vivo e status `CONNECTED`;
- `pending_login`: lease vivo e status `AWAITING_*`/`CONNECTING`;
- `awaiting`: reutiliza `countAwaitingCapacity()` de `PrismaSessionAdoptionRepository.ts:88-100` (status adotável, engine, tenant `ACTIVE`, `deletedAt IS NULL`, sem dono vivo), sem filtro de idade; com a adoção desligada grava 0 sem consultar, igual ao `GET /admin/workers` (`workerAdmin.routes.ts:48-50`);
- `capacity`: com adoção, soma dos tetos dos workers vivos; sem adoção, `maxSessionsPerWorker` × processos donos de lease (mínimo 1).

## 5. Erros

| Cenário | Tratamento | Efeito para o admin |
| --- | --- | --- |
| Configuração inválida | 400 `INVALID_WORKER_SCALING_SETTINGS` com `field` | Erro no campo |
| Outro admin salvou antes | 409 `WORKER_SCALING_SETTINGS_CONFLICT` | Recarrega e mostra o valor atual |
| Banco fora no refresh | Mantém o último valor bom; `warn` | Nenhum |
| Escalador não configurado | Estado `not_configured` com `missing` (nomes das envs ausentes); `POST /scale` → 409 `SCALER_NOT_CONFIGURED` | Lista do que falta |
| Render 429 / 5xx / timeout | Evento `failed`, erro traduzido, sem retry automático | Mensagem e botão de tentar de novo |
| Redução sem capacidade | 409 `SCALE_DOWN_WOULD_EXCEED_CAPACITY` com os números | Explica quantas sessões sobrariam |
| Dentro do intervalo mínimo | 409 `SCALE_COOLDOWN_ACTIVE` com `retryAt` | `CooldownBar` |
| Adoção desligada | 409 `ADOPTION_DISABLED` | Aviso com link para o checklist §5.1 |

## 6. Decisões técnicas

- **`current()` síncrono:** o gate decide vaga num trecho síncrono depois da checagem de credencial (T22 da E4). Leitura
  assíncrona ali reabriria a corrida entre aberturas simultâneas.
- **Evento antes da chamada externa:** grava `requested`, chama a Render, atualiza para `failed` se der erro. Queda no
  meio deixa rastro e o intervalo mínimo conta a partir do pedido.
- **Autoscaler lê amostras, não memória:** "acima do limiar por N segundos" = todas as amostras `sessions_*` da janela
  acima do limiar e pelo menos `ceil(N ÷ 300)` amostras. Cada amostra é a média de 5 min (`OPS_PERSIST_EVERY_TICKS = 5`),
  então a resolução é de 5 min e o mínimo configurável é 300 s. Depende do coletor ligado;
  sem amostra recente o job não age. O gatilho "aguardando há mais de N s" não sai das amostras (não têm idade): o job
  chama `countAwaitingCapacity(N × 1000)` ao vivo, que também é estado do banco. Recusas repetidas (`no_samples`,
  intervalo mínimo, `maxReplicas`, adoção desligada, escalador não configurado) gravam no máximo um evento por motivo por hora, travado por lease.
- **Retenção dos eventos:** a limpeza de 180 dias roda no tick do `WorkerAutoscalerJob`, no máximo uma vez por dia,
  travada por lease próprio `worker-autoscaler:cleanup` de 24 h (padrão de `ops-alert:<reason>`, `OpsMetricsSamplerJob.ts:248-252`). Até a P4 a tabela só cresce (volume: escaladas manuais).
- **Chave da Render:** a chave comum tem escrita em todos os workspaces do usuário. Fica só na env dos serviços que precisam:
  `http` (rotas de escala) e `worker` (job automático), junto de `WORKER_SCALER_ENABLED` e `WORKER_SCALER_SERVICE_ID`;
  com as envs só no worker a tela diria `not_configured` com o job escalando. A rota
  nunca devolve a chave nem o id do serviço completo. Recomendar scoped key quando sair do early access.
- **`maxShutdownDelaySeconds`:** o drain do `SIGTERM` precisa caber no prazo do serviço worker. O comportamento na
  redução de réplicas não está na documentação de referência da Render: validar em smoke (tarefa própria) antes de
  liberar a redução em produção.
- **`GET /admin/workers/scale` e a Render:** o estado vem de `getState` com cache de 30 s por processo (a tela atualiza a
  cada 20 s); `POST /scale` sempre lê ao vivo antes de agir. As rotas de métricas (`/admin/ops/metrics/*`) continuam sem
  chamar a Render. É exceção à regra "rota nunca chama a Render" (`docs/ops-metricas.md` e `AGENTS.md`): a T26 reescreve
  a regra com o recorte (só rotas de escala, com cache e timeout).
- **Navegação:** as abas novas são sub-rotas de `/admin/workers`, cobertas pelo `matchPrefix` do item existente
  (`navigation/model.ts:133`), como `/admin/workers/usage`. Sem item de menu novo.
- **Memória por sessão:** o coletor grava `memory` e `memory_pct` da Render (não o limite), com a unidade em
  `meta.unit` e um recurso por instância/serviço. A conta usa só recursos `srv-`, converte para MB, soma instâncias por
  `at` e deriva o limite de `memory ÷ (memory_pct ÷ 100)`. Com mais de um `srv-` monitorado e sem
  `WORKER_SCALER_SERVICE_ID`, não há como saber qual roda sessões: devolve `null`. Com a env (P3, T23), casa por
  prefixo do id do serviço; o formato do id de instância é conferido no smoke T25.
- **Serviço com disco não escala:** o escalador só pode apontar para serviço sem disco (mídia em S3). `getState`
  devolve `hasDisk`; com disco, `scaleTo` é recusado.

## 7. O que não fazer

- Ler o teto da env em código novo; capturar o valor do provider em construtor ou closure.
- Chamar a Render a partir das rotas de leitura de métricas (`docs/ops-metricas.md` continua valendo).
- Reduzir réplica automaticamente; subir mais de uma por decisão; retry automático de `scaleTo`.
- Guardar chave, id de serviço ou resposta crua da Render em evento, auditoria ou log.
- Derrubar sessão por redução de teto.
- Usar `Date.now()` do navegador contra horário do servidor na contagem do intervalo.
