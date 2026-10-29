# Rodízio de links — Tarefas

**Design**: `design.md` · **Status**: Draft · Branch: `feature/link-rotation` a partir de `feature/rebranding-app`
(memória: features saem e voltam para `feature/rebranding-app`). Cada tarefa = 1 subagent + 1 commit
(`type(link-rotation): …`), `tsc --noEmit` na pasta tocada antes do commit. Gate de teste: `.specs/codebase/TESTING.md`.

## Plano de execução

```
Fase 1 (sequencial)   T1 → T2 → T3
Fase 2 (paralelo)     T3 ─┬→ T4 (domain puro) ─┬→ T7 (use cases tenant) ─┬→ T10 (rotas tenant)
                          ├→ T5 (engine port)  ─┤                         ├→ T11 (rota pública)
                          └→ T6 (repos prisma) ─┴→ T8 (use cases admin)  ─┴→ T12 (rotas admin)
                                                   T9 (resolve público)  ─┘
Fase 3 (paralelo)     T13 job membros · T14 rebaixo de plano · T15 app service+strings+erros+privacidade
Fase 4 (sequencial)   T15 → T16 página + card → T17 config dialog → T18 grupos dialog + banner → T19 stats
                      T15 → T20 admin page
Fase 5                T21 catálogo/planos · T22 docs+changelog+versões · T23 QA agent-browser · T24 infra DNS (owner)
```

## Tarefas

### T1 Entitlements e presets ✅
**What**: chaves `LINK_ROTATIONS`/`LINK_ROTATION_GROUPS` em `entitlementKeys.ts`; presets 1/1/2 e 3/5/10 em `planPresets.ts`; seed já lê `planPresetRows()`.
**Where**: `api/src/modules/tenants/domain/{entitlementKeys,planPresets}.ts`, `planPresets.test.ts`.
**Requirement**: LROT-15. **Done when**: teste atualizado passa; `tsc` ok. **Commit**: `feat(link-rotation): entitlements link_rotations e link_rotation_groups`.

### T2 Schema Prisma + migration  ✅
**What**: modelos/enums da `design.md` §3; migration `create_link_rotation` com comentário PT; relações em `Tenant`, `Session`, `ChatConversation` (onDelete: Session → rotação fica sem sessão? Não: `sessionId` NOT NULL, `onDelete: Restrict` + use case de exclusão de sessão pausa rotação — ver T14).
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_create_link_rotation/migration.sql`.
**Requirement**: LROT-01,03,06,08,10. **Done when**: `prisma migrate dev` em Postgres descartável (memória: teste local com Postgres descartável) aplica; `prisma generate` ok. **Commit**: `feat(link-rotation): schema e migration`.

### T3 Erros internos  ✅
**What**: `LinkRotationErrors.ts` (códigos da `design.md` §4.2) e `GroupInviteNotAllowedError` em `GroupErrors.ts`; registrar no mapeamento HTTP se houver tabela central.
**Where**: `api/src/shared/errors/internal/`. **Requirement**: LROT-03,07. **Done when**: `tsc`; teste de status code. **Commit**: `feat(link-rotation): erros internos`.

### T4 Domínio puro [P]  ✅
**What**: `slugRules.ts` (normaliza, valida, reservados, sugestões), `pickGroup.ts` (4 estratégias, elegibilidade), `classifyUserAgent.ts`; testes unitários (vitest) cobrindo: slug inválido/reservado/sugestões; BALANCED empate; SEQUENTIAL pula cheio; WEIGHTED com rng fixo; RANDOM; nenhum elegível → null; bot/webview/browser.
**Where**: `api/src/modules/link-rotation/domain/{entities,enums,services,contracts}`. **Requirement**: LROT-03,08,09,10. **Done when**: testes verdes. **Commit**: `feat(link-rotation): regras puras de slug, escolha de grupo e UA`.

### T5 Porta do engine + adapter [P]  ✅
**What**: `getGroupInviteLink` e `getGroupSummary` em `IMessagingEngine`; implementação Baileys (`groupInviteCode`, `groupMetadata.size`, `isSelfAdmin` por PN/LID); snapshot com `size/selfIsAdmin/fetchedAt` TTL 15 min; `translateGroupInviteError`; tipagem `BaileysSocketWithGroupHelpers` com `size?`/`groupInviteCode`.
**Where**: `messaging/domain/contracts/IMessagingEngine.ts:244`, `engines/baileys/BaileysMessagingEngineAdapter.ts:478,1348-1385,1657-1703`, `BaileysErrorTranslator.ts`.
**Requirement**: LROT-07,12. **Done when**: `tsc`; teste do tradutor (Boom `data:403` → `GROUP_INVITE_NOT_ALLOWED`); nada de Baileys fora do adapter. **Commit**: `feat(messaging): invite link e resumo de grupo na porta do engine`.

### T6 Repositórios Prisma + mappers + container [P]  ✅
**What**: `PrismaLinkDomainRepository`, `PrismaLinkRotationRepository` (`findPublicByHost`, `incrementClick` em transação com `UPDATE … +1`, `isSlugAvailable` considerando reserva de outro tenant, `reserveSlug`), `PrismaLinkClickRepository` (insert, `countLast7Days`, `deleteOlderThan`); `linkRotationContainer.ts`.
**Where**: `link-rotation/infrastructure/{repositories,mappers,linkRotationContainer.ts}`. **Requirement**: LROT-03,10,13. **Done when**: teste de integração em Postgres descartável para `incrementClick` concorrente (10 em paralelo = +10) e `isSlugAvailable`. **Commit**: `feat(link-rotation): repositórios Prisma`.

### T7 Use cases do tenant  ✅
**What**: `GetLinkRotationOverview`, `CreateLinkRotation`, `RenameLinkRotation`, `UpdateLinkRotation`, `DeleteLinkRotation`, `SaveLinkRotationGroups`, `RefreshLinkRotationGroup` (regras `design.md` §4.2), DTOs. Testes unitários com fakes: limite `link_rotations`, slug tomado com sugestões, reserva 30 d, limite grupos, AUTO→NEEDS_LINK quando engine lança `GROUP_INVITE_NOT_ALLOWED`, manual inválido.
**Where**: `link-rotation/application/{use-cases,dtos}`. **Depends**: T3,T4,T5,T6. **Requirement**: LROT-03..08. **Commit**: `feat(link-rotation): use cases do tenant`.

### T8 Use cases do admin  ✅
**What**: CRUD de domínio + `ProbeLinkDomain` (token HMAC `LINK_PROBE_SECRET`, 5 min, anti-SSRF: só `https://probe-<rand>.<hostname>/…`, timeout 5 s, sem redirect). Env novas em `env.ts` (`LINK_CLICK_SALT`, `LINK_PROBE_SECRET`, `LINK_ROTATION_MEMBER_SYNC_ENABLED`).
**Where**: `link-rotation/application/use-cases/admin/*`, `shared/config/env.ts`. **Depends**: T3,T6. **Requirement**: LROT-01,02. **Done when**: testes: delete com rotação → 409; probe hostname diferente do registro → erro. **Commit**: `feat(link-rotation): domínios da plataforma (admin)`.

### T9 Resolução pública  ✅
**What**: `ResolvePublicLinkUseCase` (`design.md` §4.2) + hash de IP (`sha256(ip+dia+salt)`); `ALL_FULL` 1×/h. Testes: apex→landing; bot não conta; teto 1 → 1º A, 2º B; tenant suspenso → unavailable; pausado → paused.
**Where**: `link-rotation/application/use-cases/ResolvePublicLinkUseCase.ts`. **Depends**: T4,T6. **Requirement**: LROT-09,10,11,14. **Commit**: `feat(link-rotation): resolução pública do link`.

### T10 Rotas do tenant  ✅
**What**: `linkRotation.routes.ts` + schemas + presenter; registro em `routes.ts` prefixo `/link-rotation`; `GET /:id/groups` reaproveita listagem de grupos da sessão (`offer.routes.ts:115` → extrair use case comum se duplicar).
**Depends**: T7. **Requirement**: LROT-03..08,13. **Done when**: teste de rota (padrão `chat.routes.test.ts`): 403 `PLAN_LIMIT_REACHED` com `limit`; 409 `LINK_SLUG_TAKEN` com `suggestions`. **Commit**: `feat(link-rotation): rotas do painel`.

### T11 Rota pública por Host  ✅
**What**: `publicLink.routes.ts` fora do `API_PREFIX`; hook em `app.ts` que ativa só para hosts cujo sufixo está no cache (60 s) de `link_domains`; preset `rateLimitPresets.publicLink` 60/min; headers `no-store`, `X-Robots-Tag: noindex`; templates HTML (redirect, lotado, pausado, indisponível, 404) com `APP_NAME`, OG, meta refresh, botão, CSS inline claro/escuro via `prefers-color-scheme`; `/.well-known/link-rotation` 204; CORS não se aplica (sem credencial).
**Depends**: T9. **Requirement**: LROT-09,10,11. **Done when**: teste com `inject({ headers: { host: 'promo.copysync.app' } })` cobre os 5 estados; host `api.copysync.app` não é interceptado. **Commit**: `feat(link-rotation): página pública de redirecionamento`.

### T12 Rotas admin  ✅
**What**: `linkDomainAdmin.routes.ts` `[authHook, superAdminHook]` em `/admin/link-domains` (CRUD + probe), schemas, presenter. **Depends**: T8. **Requirement**: LROT-01,02. **Done when**: teste 403 sem super-admin. **Commit**: `feat(link-rotation): rotas admin de domínios`.

### T13 Job de membros + retenção [P]  ✅
**What**: `SyncLinkRotationMembersUseCase` + `LinkRotationMemberSyncJob` (tick 60 s, lease `JobLease` `link-rotation-member-sync`, flag env, `unref`, stop com timeout) registrado em `server.ts` ao lado do worker de ofertas; retenção `LinkClick` 90 d. Testes: só grupos vencidos (15 min ou ≥25 cliques); FULL ↔ ACTIVE; sessão desconectada pula.
**Depends**: T5,T6. **Requirement**: LROT-12. **Commit**: `feat(link-rotation): sincronização de membros por sessão`.

### T14 Rebaixo de plano e sessão removida [P]  ✅
**What**: `ApplyPlanLimitsToLinkRotationsUseCase` chamado em `SyncTenantEntitlementsUseCase`; exclusão de sessão (use case existente em `sessions`) pausa rotações da sessão (`PAUSED`, motivo); tenant `SUSPENDED` já coberto em T9.
**Depends**: T6. **Requirement**: LROT-14. **Commit**: `feat(link-rotation): limites por plano e sessão removida`.

### T15 App: service, strings, erros, privacidade  ✅
**What**: `services/linkRotation.service.ts`, `services/adminLinkDomains.service.ts`, `features/linkRotation/strings.ts` (pt-BR completo, inclusive textos do banner), `utils/linkRotationErrors.ts`, tipos; `PRIVACY_SCREENS.linkRotation` com flags `rotationLink`, `groupName`, `groupAvatar`.
**Where**: `app/src/{services,features/linkRotation,features/privacy/privacyFlags.ts}`. **Depends**: T10 (contrato). **Requirement**: LROT-13,16. **Commit**: `feat(link-rotation): serviço, textos e privacidade no painel`.

### T16 App: página e card  ✅
**What**: rota `/link-rotation`, item de menu (`Link2`) após Monitoramento, `LinkRotationPage` com `PageHeader`, estado vazio, `RotationCard` (link + Copiar com feedback 2 s, status `Switch`, sessão, chips, botões Configurar/Grupos, `Blurred`). **Depends**: T15. **Requirement**: LROT-13. **Done when**: agent-browser screenshot claro/escuro. **Commit**: `feat(link-rotation): página e card do rodízio`.

### T17 App: diálogo de configuração  ✅
**What**: `RotationConfigDialog` (sessão, domínio, slug com preview/contador/regras, estratégia com descrições, título), `usePersistedState` scope tab + `clear()`; 409 mostra sugestões clicáveis; rename com `ConfirmRenameDialog`; limite `link_rotations` → `PlanLimitBanner` (de T18, criar aqui se T18 ainda não existir). **Depends**: T16. **Requirement**: LROT-03,04,05. **Commit**: `feat(link-rotation): configuração de subdomínio`.

### T18 App: diálogo de grupos + banner de upgrade  ✅
**What**: `RotationGroupsDialog` (busca `x de y`, checkbox bloqueia acima do limite, ordem por setas, peso `RangeSlider` em WEIGHTED, teto `RangeSlider` 50–1024, link AUTO/MANUAL, estado `NEEDS_LINK`, botão atualizar), `PlanLimitBanner` animado (gradiente do tema, `Sparkles`, `prefers-reduced-motion`, CTA `/plans`), ui-ux-pro-max para o banner. **Depends**: T16. **Requirement**: LROT-06,07,08. **Commit**: `feat(link-rotation): seleção de grupos e aviso de upgrade`.

### T19 App: estatísticas [P]  ✅
**What**: `RotationStatsCard` (total, 7 dias, por grupo com barra, estados FULL/NEEDS_LINK com Tooltip). **Depends**: T16. **Requirement**: LROT-13. **Commit**: `feat(link-rotation): estatísticas do rodízio`.

### T20 App: admin de domínios [P]  ✅
**What**: `AdminLinkDomainsPage` (tabela, form, status, probe com resultado, instruções DNS colapsáveis), item em `NAV_ADMIN_ITEMS`, rota sob `SuperAdminRoute`. **Depends**: T15,T12. **Requirement**: LROT-01,02. **Commit**: `feat(link-rotation): tela admin de domínios`.

### T21 Catálogo de planos [P]  ✅
**What**: `catalog.ts` `limits.linkRotations/linkRotationGroups`, benefício e hint corrigidos (hoje descreve credenciais), `catalog.test.ts` e `planPresets.test.ts` travando os números; `PlanCard` exibe novos limites. **Depends**: T1. **Requirement**: LROT-15. **Commit**: `feat(plans): limites de rodízio de links na vitrine`.

### T22 Docs, CHANGELOG, versões  ✅
**What**: `docs/rodizio-de-links.md` (fluxo, DNS passo a passo, o que não fazer, única consulta sem tenantId), roadmap item 9 ✅, `docs/planos.md`, AGENTS.md linha de referência, `CHANGELOG.md` `[Unreleased]`, `api/package.json` 0.44.0, `app/package.json` 0.50.0. **Depends**: tudo. **Requirement**: LROT-16. **Commit**: `docs(link-rotation): documentação, changelog e versões`.

### T23 QA  ✅
**What**: agent-browser: criar rodízio, copiar link, selecionar grupos acima do limite (banner), trocar nome, pausar; abrir host público via `curl -H Host:` local nos 5 estados; claro/escuro; i18n sem string solta. Sem commit (relatório em `.specs/features/link-rotation/qa.md`).

### T24 Infra (owner, fora do código)
Cloudflare + Render por domínio conforme `design.md` §7; domínio `copysync.com.br` já validado em 2026-10-29 (DNS + certificado); falta proxy laranja, WAF e rate limit de borda antes de liberar aos tenants; `LINK_CLICK_SALT`/`LINK_PROBE_SECRET`/`LINK_ROTATION_MEMBER_SYNC_ENABLED=true` na Render.

## Rastreabilidade
| Req | Tarefas |
| --- | --- |
| LROT-01 | T2,T8,T12,T20 | LROT-02 | T8,T12,T20 | LROT-03 | T2,T3,T4,T6,T7,T10,T17 | LROT-04 | T7,T17 |
| LROT-05 | T7,T17 | LROT-06 | T7,T18 | LROT-07 | T3,T5,T7,T18 | LROT-08 | T4,T7,T18 |
| LROT-09 | T4,T9,T11 | LROT-10 | T4,T6,T9,T11 | LROT-11 | T9,T11 | LROT-12 | T5,T13 |
| LROT-13 | T6,T10,T15,T16,T19 | LROT-14 | T9,T14 | LROT-15 | T1,T21 | LROT-16 | T15,T22 |

Cobertura: 16/16 mapeados.
