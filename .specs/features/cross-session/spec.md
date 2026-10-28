# Sessão cruzada (monitorar em um WhatsApp, disparar em outro) — plano

Status: **implementado** (api 0.42.0 · app 0.48.0, 2026-10-28). T1–T8 feitos; sem migration. Roadmap: item Business "Monitorar em um WhatsApp e disparar em outro" (`docs/produto-roadmap.md`).
Vitrine já anuncia (`app/src/features/plans/catalog.ts`, app 0.43.1). Código: gerador já cruza sem gate; monitoramento não cruza.

## Estado atual

| Fluxo | Cross-sessão hoje | Gate de plano |
| --- | --- | --- |
| Gerador de ofertas (`SendOfferUseCase.ts:64-97`) | **Sim**: `config.sessionIds[]`, grupo de qualquer sessão escolhida, lane por `t.sessionId`, sender resolve engine pela conversa | Só `whatsapp_sessions` (quantas sessões na config, `OfferGeneratorConfigUseCases.ts:97`). Nada diz "destino pode ser de sessão diferente da fonte" porque no gerador não há fonte |
| Monitoramento (`ProcessPendingCapturedOffersUseCase.ts:86-130`) | **Não**: `listBroadcast(tenant, c.sessionId)` e `enqueue({ sessionId: c.sessionId })`; `EnqueueOfferUseCase` é single-sessão | `monitored_groups`, `broadcast_groups`, `mention_all_enabled` |
| Presets (`api/prisma/seed.ts:100-104`) | — | Só `marketplace_extension`. Limites numéricos **não estão no seed** |

Nota: no Starter/Profissional `whatsapp_sessions = 1`, então o gerador já não cruza na prática. O gate explícito
serve para Business com 2 sessões e para quando o hub mandar um preset diferente.

## Entitlement novo

`cross_session_dispatch: boolean` (default **false** quando ausente; `null`/ausente = bloqueado, ao contrário dos
limites numéricos onde `null` = ilimitado). Erro: `PlanFeatureUnavailableError('cross_session_dispatch')` →
`PLAN_FEATURE_UNAVAILABLE` 403 (já existe em `shared/errors/internal/PlanErrors.ts:11`; app já trata em
`offers/strings.ts:356`). Constante única em `api/src/modules/tenants/domain/entitlementKeys.ts` (hoje as chaves são
literais duplicados em `campaigns` e `automation`: consolidar junto).

Semântica: **grupo de destino em sessão diferente de onde a oferta nasce**.
- Gerador: nasce na sessão "principal" = a primeira de `config.sessionIds` (ou a sessão do grupo de origem quando houver).
  Regra simples: `sessionIds.length > 1` exige `cross_session_dispatch`. Sem ele, erro ao salvar config.
- Monitoramento: `BroadcastGroup.sessionId !== config.sessionId` exige `cross_session_dispatch`.

## Tarefas

| # | Tarefa | Onde | Verificação |
| --- | --- | --- | --- |
| T1 | `entitlementKeys.ts` com todas as chaves (`WHATSAPP_SESSIONS`, `MONITORED_GROUPS`, `BROADCAST_GROUPS`, `MENTION_ALL_ENABLED`, `OFFER_GENERATIONS_PER_DAY`, `MARKETPLACE_EXTENSION`, `CROSS_SESSION_DISPATCH`); trocar literais | api tenants/campaigns/automation | `tsc`; grep sem literal solto |
| T2 | Seed: presets numéricos e booleanos dos 3 planos (tabela do roadmap) + `cross_session_dispatch: true` só em `COPYSYNC_BUSINESS` | `api/prisma/seed.ts` | teste comparando seed × `app/src/features/plans/catalog.ts` `limits` (spec plans T6) |
| T3 | Gate no gerador: em `SaveOfferGeneratorConfig` (`OfferGeneratorConfigUseCases.ts:~97`), `sessionIds.length > 1 && !getBoolean(CROSS_SESSION_DISPATCH)` → `PlanFeatureUnavailableError`. Repetir no `SendOfferUseCase` (plano rebaixado depois de salvar: filtra destinos para a sessão principal, como já faz com `broadcast_groups`) | api campaigns | teste unitário dos dois use cases |
| T4 | Monitoramento, dado: `replaceBroadcast`/`listBroadcast` passam a escopar por `configId`; `SaveBroadcastGroups` aceita `sessionId` por grupo, `ensureGroup(tenant, g.sessionId, jid)`, sessão de destino tem que ser do tenant; se algum `g.sessionId !== config.sessionId` → gate `CROSS_SESSION_DISPATCH` | api automation (`GroupMonitorConfigUseCases.ts:84-135`, `PrismaGroupMonitorRepository.ts:87`) | teste: mesma sessão passa sem entitlement; cruzada exige |
| T5 | Monitoramento, envio: `ProcessPendingCapturedOffersUseCase` agrupa destinos por `sessionId` e chama `queue.enqueue` uma vez por sessão de envio (lane certa); ou `EnqueueOfferUseCase` aceita `{conversationId, sessionId}[]` como o `SendOfferUseCase`. Preferir a segunda: um só caminho de fila | api automation/campaigns | teste: 2 sessões → 2 lanes |
| T6 | Painel monitoramento: `GroupPickerDialog` modo disparo recebe todas as sessões conectadas quando `cross_session_dispatch` (vem no `GET /config` do monitoramento junto de `limits`); chip da sessão em cada grupo; sem o entitlement, só a sessão atual e aviso "disponível no Business" com link `/plans` | app monitoring | agent-browser |
| T7 | Painel gerador: `ConfigSessionStep` já limita por `whatsapp_sessions`; adicionar aviso quando 2+ sessões e sem `cross_session_dispatch` (erro 403 já cai em `offerErrors.ts`) | app offers | — |
| T8 | Docs: `docs/monitoramento-grupos.md` (linha "só grupo de que a sessão participa"), `docs/gerador-de-ofertas.md`, `docs/planos.md` pendência; CHANGELOG; api minor, app minor | docs | — |

Ordem: T1 → T2 → T3 (gerador fica "meio pronto" para o hub) → T4/T5 → T6/T7 → T8. T1–T3 cabem num PR só, sem migration.
T4 muda escopo de unique/índice? Não: `BroadcastGroup` já tem `sessionId` próprio e FK `configId`; `@@unique([tenantId, sessionId, conversationId])` continua válido.

## O que não fazer
- Não decidir cross-sessão por `whatsapp_sessions > 1`: é limite de quantidade, não permissão.
- Não gravar o entitlement no `GroupMonitorConfig`: lê-se do `IEntitlementReader` a cada operação, como os demais.
- Não deixar `null` liberar: feature booleana ausente = desligada.
