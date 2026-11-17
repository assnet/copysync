# Saver — Tarefas

**Design**: `design.md` · **Status**: Em execução (2026-11-17): ✅ T1–T19 (API); ✅ T20–T26 (painel); ✅ T27 docs + api 0.100.0/app 0.123.0; 🟡 T28 QA visual feito, smoke com sessão real pendente (dono); P2 T29–T32 não iniciadas (pré-requisito `product-access` aprovado em 2026-11-11) · Branch: `feature/saver` a partir de `feature/rebranding-app`, **depois** do
merge de `feature/product-access`. Cada tarefa = 1 subagente + 1 commit `type(saver): …`.
Gate: `.specs/codebase/TESTING.md` (`quick` ao fim da task, `full` antes do commit). Migration nunca roda contra
`api/.env` (produção): só Postgres descartável. `git add` só com caminhos explícitos. `[P]` = paralela dentro da fase.
Teto: 3 subagentes com banco ao mesmo tempo; monitorar `memory_pressure` (livre ≥ 20%).

## Plano de execução

```
Fase 0               T1 roadmap e registro das decisões (D1–D3, D6 fechadas; D4, D5 e preço adiados, não bloqueiam)
Fase 1 (paralelo)    T1 ─┬→ T2 entitlements e planos [P]
                         ├→ T3 domínio: permissões, limites, enums [P]
                         ├→ T5 porta do engine + adapters [P]
                         ├→ T6 mergeGroupRead (contato único) [P]
                         └→ T7 formatadores de exportação [P]
                     T2 → T4 schema + migrations
Fase 2               T3,T4 → T8 repositórios + container
                     T5 → T13 tradução de limite de taxa
Fase 3 (paralelo)    T8 ─┬→ T10 resumo [P]
                         ├→ T11 grupos da sessão [P]        (também T5)
                         ├→ T12 pedir/cancelar/remover [P]
                         ├→ T16 base da plataforma (super admin) [P]
                         ├→ T17 exportar [P]                (também T7)
                         ├→ T18 configuração + liberação de exportar [P]
                         └→ T19 manutenção de extrações órfãs [P]
                     T5,T6,T8,T13 → T9 passo da extração
Fase 4 (sequencial)  T9,T19 → T14 job + flag
                     T10,T11,T12,T16,T17,T18 → T15 rotas + registro + teste de independência
Fase 5 (painel)      T15 → T20 base do painel → T21 menu e rotas ─┬→ T22 Grupos [P] → T24 Exportar
                                                                  ├→ T23 Base da plataforma (super admin) [P]
                                                                  ├→ T25 Configurações [P]
                                                                  └→ T26 Planos [P]      (também T2)
Fase 6               T27 docs + changelog + versões → T28 QA e smoke
P2 (depois da v1)    T29 atualização diária · T30 enriquecimento passivo · T31 aviso de uso (D4) · T32 expurgo (D5)
```

## Tarefas

### T1 Roadmap e decisões
**What**: preencher o item Saver em `docs/produto-roadmap.md` (funcionalidades, planos `SAVER_LITE`/`PRO`/`MAX`, posição na ordem de entrega) com as decisões de 2026-11-10 (`spec.md`, "Decisões do dono"); registrar em `.specs/features/saver/context.md`, incluindo preços, sessões 1/1/2, a base de contatos ser da plataforma (só super admin), o que ficou adiado (D4, retenção) e as três linhas *proposta* de `design.md` §2.1.
**Where**: `docs/produto-roadmap.md`, `.specs/features/saver/context.md`.
**Depends**: — · **Requirement**: regra do `AGENTS.md` ("feature nova deve caber em um item de lá") · **Tests**: none · **Gate**: —
**Done when**: decisões fechadas e adiadas escritas; roadmap lista os três planos com grupos e contatos; preços mensal e anual escritos; pendência jurídica (termos avisando o tenant, base legal) listada como bloqueio de venda em escala. **Commit**: `docs(saver): produto Saver no roadmap`.

### T2 Entitlements e planos [P]
**What**: chaves `SAVER_*` em `entitlementKeys.ts`; `SAVER_PLAN_SLUGS` e presets em `planPresets.ts` (sem tocar `PLAN_SLUGS`); tiers reais em `resolvePlan` (slug `copysync-saver-*` **e** permissão `SAVER_{TIER}`, que a central manda no snapshot; `unknownPlanPermissions` não avisa por elas — estrutura em `product-access` T2/T10); `planPresetRows()` inclui Saver.
**Where**: `api/src/modules/tenants/domain/{entitlementKeys,planPresets,planCatalog}.ts` (+ testes).
**Depends**: T1 · **Reuses**: T1 de `link-rotation/tasks.md` · **Requirement**: SAVER-02 · **Tests**: unit · **Gate**: quick
**Done when**: teste trava presets × tabela do roadmap; testes existentes de `planPresets` passam (ajuste só onde contam linhas); `copysync-saver-{tier}-{mensal|anual}` resolve produto `SAVER`; presets Saver trazem `telegram_sessions: 0`; `whatsapp_sessions` 1/1/2; `SAVER_MAX` grava `null` **explícito** em `saver_groups` e `saver_contacts` (teste falha se a chave for omitida); slugs Saver em `ALL_PLAN_SLUGS` e fora de `PLAN_SLUGS`; evento só com permissão `SAVER_PRO` resolve `SAVER`/`SAVER_PRO` sem `warn`; nenhuma chave `saver_*` entra em `ADMIN_EDITABLE_ENTITLEMENTS` na v1 (`adminEditableEntitlements.ts:16-20`). **Commit**: `feat(saver): entitlements e planos`.

### T3 Domínio: permissões, limites e enums [P]
**What**: `saverPermissions.ts` (`canSaver(role, action, grants)`), `saverLimits.ts` (ausente = 0, `null` = ilimitado), enums de status e formato, entidades e contratos de repositório.
**Where**: `api/src/modules/saver/domain/{services,enums,entities,contracts}/`.
**Depends**: T1 · **Reuses**: `chat/domain/services/diffRemoteState.ts` (estilo de função pura) · **Requirement**: SAVER-03,04,43 · **Tests**: unit · **Gate**: quick
**Done when**: matriz papel × ação × liberação testada (`OPERATOR` sem liberação não exporta; com liberação exporta e continua sem configurar; `ADMIN` ignora liberação) e os três casos de limite. **Commit**: `feat(saver): permissões e limites`.

### T4 Schema e migrations
**What**: modelos de `design.md` §3; migrations `create_saver_tables` (contatos únicos da plataforma sem `tenantId`, vínculos com nome e data da extração, `removedAt` no grupo, liberações com FK composta para `user_tenants`, índice único parcial de item pendente em SQL cru), `add_audit_actions_saver`, `add_saver_plan_presets` (`ON CONFLICT DO NOTHING`).
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_*/`, união TS de `AuditAction`.
**Depends**: T2 · **Reuses**: `20261111090500_add_marketplace_shein_entitlement` · **Requirement**: SAVER-10,33,36,43,44 · **Tests**: none (schema) · **Gate**: build
**Done when**: `prisma migrate deploy` em Postgres descartável; `prisma generate`; `pnpm typecheck`; nenhuma coluna nova em tabela existente (só relações inversas em `Tenant`/`Session`/`UserTenant`); no descartável: segundo `INSERT` do mesmo `phone` falha (mesmo vindo de outro tenant), e apagar a linha de `user_tenants` apaga a liberação. **Commit**: `feat(saver): tabelas do Saver`.

### T5 Porta do engine e adapters [P]
**What**: `getGroupMembers` + `GroupMemberInfo` na porta; `normalizeGroupMembers.ts` puro; implementação Baileys (sem foto, sem cache); Telegram lança `EngineOperationUnsupportedError`; entrada em `ENGINE_CALL_PLAN`, `RemoteMessagingEngineAdapter`, `MessagingEngineRouter` e fakes.
**Where**: `api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`, `infrastructure/engines/{baileys,telegram}/`, `infrastructure/remote/` (`engineCallPlan.ts`, `RemoteMessagingEngineAdapter.ts`), `MessagingEngineRouter.ts`.
**Depends**: T1 · **Reuses**: T5 de `link-rotation/tasks.md` (`getGroupSummary`) · **Requirement**: SAVER-08,11 · **Tests**: unit (normalização) · **Gate**: full
**Done when**: testes: participante PN, participante `@lid` com `phoneNumber`, `@lid` sem número, admin/superadmin, sem nome; `getGroupParticipants` sem diff; nada de Baileys fora de `engines/baileys/`; `engineCallPlan.test.ts` (contagem `rpc` 17 → 18) e `RemoteMessagingEngineAdapter.test.ts` (`ARGS.getGroupMembers`) atualizados **sem remover** asserção existente; contagem total de testes da API não diminui. **Commit**: `feat(messaging): membros de grupo sem foto na porta do engine`.

### T6 Contato único e vínculos [P]
**What**: `mergeGroupRead` (`design.md` §4.2): contato único na plataforma, vínculo por grupo do tenant (nome lido, data e hora da extração), fusão LID↔telefone, saída e retorno.
**Where**: `api/src/modules/saver/domain/services/mergeGroupRead.ts` (+ teste).
**Depends**: T1 · **Requirement**: SAVER-13,44 · **Tests**: unit · **Gate**: quick
**Done when**: casos: primeiro scan; pessoa já na base por outro grupo ou outro tenant (0 inserção, 1 vínculo com o nome desta leitura e `lastExtractedAt`); releitura atualiza `lastExtractedAt` e mantém `firstExtractedAt`; membro saiu; voltou; LID ganhou telefone (1 contato); LID e telefone em contatos distintos → fusão mantém o mais antigo e migra vínculos; nome vazio não apaga nome existente; contato com telefone relido só com LID mantém o telefone; LID conhecido com telefone diferente → telefone antigo fica e o novo vira outro contato; contato só-telefone + leitura só-LID → 2 contatos, fundidos quando o par chega; nunca funde por nome; 1.000 membros em < 50 ms. **Commit**: `feat(saver): contato único na base da plataforma`.

### T7 Formatadores de exportação [P]
**What**: `csvHeader`, `toCsvLine`, `toVCardEntry`, `neutralizeFormula`, `formatCapturedAt`, `applyExportOptions` (por linha, para stream).
**Where**: `api/src/modules/saver/domain/services/exportFormatters.ts` (+ teste).
**Depends**: T1 · **Requirement**: SAVER-25..29 · **Tests**: unit · **Gate**: quick
**Done when**: BOM presente; colunas do tenant `Nome,Telefone,LID,Extraído em` (+ `Grupo` com "uma linha por grupo") e do super admin (`design.md` §4.2); data e hora em `America/Sao_Paulo` conferida com instante UTC que cruza a meia-noite; só-LID entra no CSV e fica fora do vCard; vírgula/aspas/quebra de linha/emoji; `=`, `+`, `-`, `@` neutralizados (telefone com `+` no vCard preservado); vCard sem cabeçalho nem campo vazio; sem nome: vCard usa número, CSV fica vazio. **Commit**: `feat(saver): formatadores CSV e vCard`.

### T8 Repositórios e container
**What**: `PrismaSaverGroupRepository`, `PrismaSaverMembershipRepository` (tenant: contagens, keyset de exportação, sempre com `tenantId`), `PrismaPlatformSaverContactRepository` (busca por `phone`/`lid` da leitura, `ON CONFLICT DO UPDATE` em lote de 500 ordenado, fusão sob advisory lock, keyset do super admin com cursor assinado no molde `infraCostTenantCursor.ts`), `PrismaSaverExportGrantRepository`, `PrismaSaverTeamReader`, `PrismaSaverExtractionQueue` (`claimNext` com `SKIP LOCKED`, devolução de trava vencida), `PrismaSaverSessionStateStore`, `PrismaSaverConfigRepository`, mappers, `saverContainer.ts`.
**Where**: `api/src/modules/saver/infrastructure/`.
**Depends**: T3, T4 · **Reuses**: `linkRotationContainer.ts:47-133` · **Requirement**: SAVER-10,12,13,16,43,44 · **Tests**: unit (mappers) + integration · **Gate**: full + `integration-db`
**Done when**: integração: 10 claims concorrentes da mesma sessão = 1 vencedor; item `RUNNING` com trava vencida é retomado; gravação de 1.000 contatos em transação; duas gravações concorrentes de **tenants diferentes** com a mesma pessoa = 1 contato e 2 vínculos, sem deadlock; exportação do tenant A não traz nome, grupo nem data do tenant B (SAVER-46); todo método do repositório de tenant filtra `tenantId`; só o repositório `Platform*` lê `saver_contacts` sem tenant. Se passar de ~400 linhas, dividir em T8a (grupos/contatos/liberações/config) e T8b (fila/estado). **Commit**: `feat(saver): repositórios`.

### T9 Passo da extração
**What**: `ProcessNextSaverItemUseCase` (`design.md` §4.3, passos 1–6).
**Where**: `api/src/modules/saver/application/use-cases/ProcessNextSaverItemUseCase.ts`, `saverTestFakes.ts`.
**Depends**: T5, T6, T8, T13 · **Requirement**: SAVER-12..17,19,20 · **Tests**: unit · **Gate**: quick
**Done when**: testes com relógio e sorteio fixos: ritmo 3–5 s por sessão; sessão alheia ignorada; desconectada não conta tentativa; limite de taxa pausa 15 min; 3 falhas → `FAILED`; teto conta contato distinto vinculado ao tenant (já vinculado não consome; já na base por outro tenant consome ao ganhar o primeiro vínculo) e não grava pela metade; produto inativo cancela; fechamento `DONE`/`PARTIAL`/`FAILED`. **Commit**: `feat(saver): passo da extração`.

### T10 Resumo do Saver [P]
**What**: `GetSaverOverviewUseCase` + DTO.
**Depends**: T8 · **Requirement**: SAVER-05,18 · **Tests**: unit · **Gate**: quick
**Done when**: testes: chave ausente → limite 0; `null` explícito → ilimitado; permissões de `ADMIN`, `OPERATOR` e `OPERATOR` com exportação liberada; `queueRunning` reflete a flag; uso conta só o tenant informado. **Commit**: `feat(saver): resumo com limites e permissões`.

### T11 Grupos da sessão [P]
**What**: `ListSaverSessionGroupsUseCase` (sessão do tenant, WhatsApp, conectada; marca salvos).
**Depends**: T5, T8 · **Reuses**: `listParticipatingGroups` · **Requirement**: SAVER-06,07,08 · **Tests**: unit · **Gate**: quick
**Done when**: sessão de outro tenant → não encontrada; Telegram → `ENGINE_OPERATION_UNSUPPORTED`. **Commit**: `feat(saver): grupos da sessão`.

### T12 Pedir, cancelar e remover [P]
**What**: `RequestSaverExtractionUseCase`, `GetSaverExtractionUseCase`, `CancelSaverExtractionUseCase`, `RemoveSaverGroupUseCase`.
**Depends**: T8 · **Requirement**: SAVER-09,10,17,33 · **Tests**: unit · **Gate**: quick
**Done when**: limite de grupos e diário barram antes de gravar; grupo pendente não duplica; `OPERATOR` não remove; remover grupo marca `removedAt`, libera o limite, não executa `DELETE`; extrair de novo reativa; lista de grupos devolve só contagens. **Commit**: `feat(saver): pedido de extração`.

### T13 Tradução de limite de taxa
**What**: confirmar na lib Baileys (código e `https://baileys.wiki/`) a forma do erro de limite de taxa em `groupMetadata`; mapear para `EngineRateLimitedError` (novo). Sem confirmação, registrar "não confirmado" e manter o mapeamento atual.
**Where**: `engines/baileys/BaileysErrorTranslator.ts` (+ teste), `shared/errors/internal/MessagingErrors.ts`.
**Depends**: T5 · **Requirement**: SAVER-14 · **Tests**: unit · **Gate**: quick
**Done when**: testes existentes do tradutor passam sem edição; caso novo coberto ou decisão registrada. **Commit**: `feat(messaging): traduz limite de taxa do engine`.

### T14 Job de extração e flag
**What**: `SaverExtractionJob` (tick 2 s, sem sobreposição, sessões do processo por `ownerWorkerId` + `leaseUntil`, manutenção horária sob `PrismaJobLease`); env `SAVER_EXTRACTION_WORKER_ENABLED`; `'saverExtraction'` em `processJobs.ts`; liga/desliga em `server.ts`.
**Where**: `api/src/modules/saver/infrastructure/jobs/`, `api/src/shared/config/env.ts` (+ `env.saver.test.ts`), `api/src/app/{processJobs,server}.ts`.
**Depends**: T9, T19 · **Reuses**: `LinkRotationMemberSyncJob.ts`, `PrismaLinkRotationMemberSyncStore.ts:24`, `server.ts:316-321,579` · **Requirement**: SAVER-12,18,36 · **Tests**: unit (job com timers falsos; `jobsFor`) · **Gate**: full
**Done when**: flag `false` = job não inicia; papel `http` não liga; shutdown para o intervalo. **Commit**: `feat(saver): job de extração`.

### T15 Rotas, registro e independência
**What**: `saver.routes.ts`, schemas, `SaverPresenter`; registro `withProduct('SAVER', …)` em `routes.ts` e no `ROUTE_PRODUCT_MAP`; teste que varre `modules/saver` e falha em import de `chat|campaigns|automation|link-rotation|storefront`.
**Where**: `api/src/modules/saver/presentation/`, `api/src/app/routes.ts`, `api/src/modules/saver/saverIndependence.test.ts`.
**Depends**: T10, T11, T12, T16, T17, T18 · **Requirement**: SAVER-01, SAVER-47 e todas as rotas · **Tests**: unit com `inject` · **Gate**: full
**Also**: `saver` em `FEATURE_AUDIENCE_KEYS`, env `SAVER_AUDIENCE`, `saverAudienceHook`, `GET /saver/access`, linha "Saver" em `/admin/plan-entitlements`: `ListAdminPlanEntitlementsUseCase` anexa as chaves de audiência fora da allowlist, com `plans` vazio e sem `type` (design §2.3).
**Done when**: sem produto → 403 em toda rota `/saver/*` (inclui `/permissions`), em qualquer modo do gate; tenant com plano Afiliados MAX e sem Saver → 403; audiência "Só super admin": tenant com plano Saver → 403 `SAVER_UNAVAILABLE`, super admin → 200, `/saver/access` = falso para o tenant; audiência aberta: tenant com plano Saver → 200; `/admin/saver/*` registrada fora do gate com hook de super admin: `ADMIN` de tenant → 403, super admin sem produto → 200; teste varre as respostas JSON de `/saver/*` e falha se houver campo `phone`/`lid`; exportação responde com `Content-Disposition`; handler de arquivo usa `return reply`. **Commit**: `feat(saver): rotas do painel`.

### T16 Base da plataforma: consultar e exportar [P]
**What**: `ListPlatformSaverContactsUseCase`, `GetPlatformSaverContactUseCase`, `ExportPlatformSaverContactsUseCase` (só `SUPER_ADMIN`; cursor keyset assinado, inválido = 400; busca, filtro por tenant e período; `AuditLog`).
**Depends**: T8 · **Reuses**: `ListGroupParticipantsUseCase.ts:34,88-92` · **Requirement**: SAVER-45 · **Tests**: unit · **Gate**: quick
**Done when**: `ADMIN`/`OPERATOR` → 403 no use case; cursor de outro filtro reinicia; detalhe lista tenant, grupo, data e hora; cada consulta e exportação grava `AuditLog` sem nome nem número. **Commit**: `feat(saver): base de contatos da plataforma`.

### T17 Exportar [P]
**What**: `ExportSavedContactsUseCase` (permissão com liberação, grupos do tenant, contagem prévia, gerador assíncrono por keyset sobre vínculos, opções, `AuditLog`).
**Depends**: T7, T8 · **Reuses**: `GrantPremiumSlugUseCase.ts:47-51` · **Requirement**: SAVER-25..30 · **Tests**: unit · **Gate**: quick
**Done when**: grupo de outro tenant ou removido → recusado; nome vem do vínculo; `OPERATOR` sem liberação → 403; com liberação → arquivo; liberação revogada → 403 na chamada seguinte; vazio → 422 antes do primeiro byte; 120 mil linhas falsas exportadas sem montar tudo em memória (gerador consumido por lote); auditoria sem nome, número nem LID. **Commit**: `feat(saver): exportação auditada`.

### T18 Configuração e liberação de exportar [P]
**What**: `GetSaverConfigUseCase`, `UpdateSaverConfigUseCase`, `ListSaverExportGrantsUseCase`, `SetSaverExportGrantUseCase`.
**Depends**: T8 · **Reuses**: `OfferGeneratorConfigUseCases.ts` · **Requirement**: SAVER-31,32,43 · **Tests**: unit · **Gate**: quick
**Done when**: testes: tenant sem linha devolve os padrões; `OPERATOR` → 403 ao salvar; `autoRefresh` sem entitlement → `PLAN_FEATURE_UNAVAILABLE`; liberação: `OPERATOR` chamando → 403; alvo de outro tenant → não encontrado; alvo `ADMIN` → recusado; ligar duas vezes = 1 linha; `AuditLog SAVER_PERMISSION_CHANGED` só com ids. **Commit**: `feat(saver): configurações por tenant`.

### T19 Manutenção de extrações órfãs [P]
**What**: `CloseOrphanSaverExtractionsUseCase` (cancela itens `QUEUED`/`RUNNING` de sessão com `deletedAt`, exclusão lógica; fecha extração sem item pendente). **Não apaga contato**: expurgo saiu da v1 (D5 → T32).
**Depends**: T8 · **Requirement**: SAVER-36 · **Tests**: unit · **Gate**: quick
**Done when**: sessão com `deletedAt` tem itens pendentes cancelados e outra sessão consegue reler o mesmo grupo; extração órfã fecha `PARTIAL`/`CANCELLED`; extração com item pendente não é tocada; nenhum `DELETE` em `saver_contacts`. **Commit**: `feat(saver): fecha extrações órfãs`.

### T20 Painel: base
**What**: `saver.service.ts`, `types.ts`, `strings.ts`, flags de privacidade, hooks de dados, tratamento de erros do Saver.
**Where**: `app/src/services/saver.service.ts`, `app/src/features/saver/`, `app/src/features/privacy/privacyFlags.ts`, `app/src/types/api.types.ts`.
**Depends**: T15 · **Reuses**: `features/redirectLinks/`, `useCapturedOffers.ts` · **Requirement**: SAVER-23,38 · **Tests**: unit (hooks com serviço falso; funções puras) · **Gate**: quick
**Done when**: nenhuma chamada Axios fora de `saver.service.ts`; nenhum texto visível fora de `strings.ts`; flags `saver.groupNames`, `saver.teamNames` e `saverAdmin.contactNames`/`contactPhones`/`tenantNames` aparecem na tela de privacidade; mapeamento de erro cobre `PRODUCT_UNAVAILABLE`, `PLAN_LIMIT_REACHED`, `SESSION_NOT_CONNECTED`, `ENGINE_OPERATION_UNSUPPORTED`. **Commit**: `feat(app): base do Saver no painel`.

### T21 Menu e rotas
**What**: produto Saver `available` com 3 itens (Grupos, Configurações, Planos); item "Base de contatos" (`/admin/saver`) no grupo de administração, só super admin; rotas sob `ProductRoute`; `PRODUCT_HOME.SAVER`/`PRODUCT_PLANS_PATH.SAVER`; `/members` → `/saver`; tagline "Exporte os contatos dos seus grupos" em `navigation/strings.ts:20`; `saverVisible` (de `/saver/access`) esconde o item Saver inteiro quando falso. As páginas entram como esqueleto e são preenchidas em T22–T26.
**Where**: `app/src/features/navigation/{model.ts,model.test.ts,strings.ts}`, `app/src/features/products/productAccess.ts`, `app/src/routes/AppRoutes.tsx`, `app/src/app/AppLayout.tsx` + hook `useSaverAccess` (molde `useOfferHunterAccess`), `app/src/pages/admin/AdminPlanEntitlementsPage.tsx` (célula "—" em linha sem `type`), `app/src/features/planEntitlementsAdmin/strings.ts` (`features.saver`).
**Depends**: T20 · **Requirement**: SAVER-37,47 · **Tests**: unit · **Gate**: full
**Done when**: audiência "Só super admin": usuário comum não vê Saver no menu, super admin vê; caso legado do menu inalterado fora do item Saver; tenant só-Saver tem início em `/saver`; audiência aberta: tenant sem Saver vê o produto com cadeado e vai a `/saver/plans`; linha "Saver" no admin sem Switch nas colunas de plano. **Commit**: `feat(app): Saver no menu`.

### T22 Tela Grupos [P]
**What**: `SaverGroupsPage` (`SessionPicker`, `GroupSelectionTable`, `ExtractionProgress`, `SaverLimitBanner`), `usePersistedState`, privacidade.
**Depends**: T21 · **Requirement**: SAVER-06,07,08,09,24,38 · **Tests**: unit (componentes, claro e escuro) · **Gate**: quick · **Skills**: ui-ux-pro-max, web-design-guidelines
**Done when**: testes: lista vazia, sessão desconectada (atalho para reconectar), sessão Telegram (aviso), seleção persiste após remontar e limpa ao concluir, progresso para de consultar ao terminar, faixa de limite com CTA; nomes de grupo borrados com a flag; sem `Date.now()` contra horário do servidor. **Commit**: `feat(app): tela de grupos do Saver`.

### T23 Tela super admin: base de contatos [P]
**What**: `features/saverAdmin/` (`PlatformContactsPage`, tabela, detalhe com extrações, exportar CSV), cursor, privacidade.
**Depends**: T21 · **Requirement**: SAVER-45,23,38 · **Tests**: unit · **Gate**: quick · **Skills**: ui-ux-pro-max
**Done when**: testes: rota e item de menu ausentes para quem não é super admin; uma linha por contato com telefone, LID, nº de tenants/grupos e data e hora; "carregar mais" usa só `nextCursor`; trocar filtro reinicia; nome, número/LID e nome de tenant borrados pelas flags; estado vazio e de erro; claro e escuro. **Commit**: `feat(app): base de contatos da plataforma no admin`.

### T24 Exportar no painel
**What**: `ExportDialog` aberto da tela Grupos (grupos marcados ou todos; formato, só com número, prefixo, administradores, uma linha por grupo, resumo de incluídos e, no vCard, excluídos sem número), download por `Blob`.
**Depends**: T22 · **Reuses**: `offerStory/shareImage.ts:43-58` · **Requirement**: SAVER-25..29 · **Tests**: unit · **Gate**: quick
**Done when**: botão segue `permissions.export` do resumo (ausente para `OPERATOR` sem liberação, presente com liberação); 403 forçado mostra "peça ao administrador"; opções limpas após o download. **Commit**: `feat(app): exportação do Saver`.

### T25 Tela Configurações [P]
**What**: `SaverSettingsPage` (`Switch` do tema, prefixo, formato; somente leitura para `OPERATOR`) + seção "Quem pode exportar" (operadores com `Switch` e `Tooltip`; só `ADMIN`).
**Depends**: T21 · **Requirement**: SAVER-31,32,43 · **Tests**: unit · **Gate**: quick
**Done when**: testes: `OPERATOR` vê tudo desabilitado e sem botão salvar; atualização diária desabilitada com dica quando o plano não inclui; rascunho persiste após remontar e limpa ao salvar; liga/desliga é o `Switch` do tema; seção de liberação oculta para `OPERATOR`, vazia com texto de orientação quando não há operador, falha ao salvar desfaz o `Switch`; nome do operador borrado com `saver.teamNames`. **Commit**: `feat(app): configurações do Saver`.

### T26 Vitrine de planos [P]
**What**: `features/saver/plans/catalog.ts` + `SaverPlansPage`; teste que trava catálogo × presets.
**Depends**: T2, T21 · **Reuses**: `features/plans/catalog.ts` e `catalog.test.ts` · **Requirement**: SAVER-39 · **Tests**: unit · **Gate**: quick · **Skills**: copywriting
**Done when**: três planos (Lite, Pro, Max) com "ilimitado" e 2 sessões no Max; preços do catálogo: mensal R$ 29,90 / 39,90 / 49,90, anual R$ 23,90 / 32,90 / 39,90 por mês com o texto "cobrado anualmente" e o total do ano; teste trava limites do catálogo × presets da API; nenhum preço vindo da API; plano atual do tenant destacado; texto não promete nome nem número para todo membro (limitação do número oculto dita em linguagem simples). **Commit**: `feat(app): vitrine de planos do Saver`.

### T27 Documentação e versões
**What**: `docs/saver.md` (o que faz, limites, ritmo, LID, base de contatos da plataforma e quem acessa, liberação de exportar, pendências (aviso D4, retenção, termos/base legal como bloqueio de venda em escala), o que não fazer); linha no `AGENTS.md`; `docs/navegacao-produtos.md`, `docs/produto-roadmap.md`; nota em `docs/chat-ingestao-por-entitlement.md` (par LID de participante agora mora no Saver); `api/CHANGELOG.md`; api e app na próxima minor após `product-access`.
**Depends**: T1–T26 · **Tests**: none · **Gate**: full
**Commit**: `docs(saver): documenta o módulo Saver (api X.Y.0, app X.Y.0 — próxima minor)`.

### T28 QA e smoke
**What**: agent-browser em Postgres descartável (claro/escuro, privacidade, tenant só-Saver, `OPERATOR` sem e com exportação liberada); mesmo contato em dois grupos sai uma vez no arquivo; tenant não encontra tela nem resposta com contato; super admin vê contato extraído por dois tenants com os dois vínculos; smoke com sessão WhatsApp real (grupo pequeno, ~1.000, com números ocultos); abrir CSV no Excel e Google Sheets; importar vCard em Android e iPhone; smoke de não regressão (menção a todos, participantes do chat).
**Depends**: T27 · **Tests**: smoke · **Gate**: smoke
**Done when**: taxa real de membros com nome e com número anotada em `docs/saver.md`; nenhum bloqueio de conta observado. Smoke com sessão real e ligar a flag na Render são ações do dono.

### P2
- **T29 Atualização diária** (SAVER-40): enfileirar no job grupos com `lastScannedAt` > 24 h, respeitando o limite diário. Depends: T14.
- **T30 Enriquecimento passivo** (SAVER-41): listener de `MESSAGE_RECEIVED` no módulo `saver`, flag `SAVER_PASSIVE_ENRICHMENT_ENABLED`, 1 escrita por membro por 24 h. Depends: T8. Verificar antes se o evento é emitido com chat desligado.
- **T31 Aviso de uso responsável** (SAVER-42, D4): tabela de aceites só-inclusão, versão do texto, aceite de `ADMIN`. Depends: T15. Reuses: `marketplace_risk_acceptances`. **Só começa quando o dono avisar.**
- **T32 Expurgo** (SAVER-34,35, D5): `PurgeSaverDataUseCase` + passo no job. **Bloqueada até o dono definir a regra** (retenção e prazo após perder o produto). Depends: T14. Reuses: `PurgeExpiredLinkClicksUseCase.ts:5-33`; `tenant_products.inactiveSince` já existe desde `product-access`.

## Validação das tarefas

**Granularidade**: cada task = 1 função pura, 1 use case (ou par get/update coeso), 1 tela ou 1 job. T5 toca vários arquivos por obrigação do contrato (o `satisfies` do plano de chamadas não compila pela metade): fica atômica por ser 1 método. T8 reúne os repositórios do mesmo módulo, com divisão prevista em T8a/T8b. T18 junta configuração e liberação de exportar: mesma tela, mesma permissão (`configure`), dois pares de use case pequenos.

**Diagrama × `Depends`**:

| Task | Depends (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T2, T3, T5, T6, T7 | T1 | T1 → T2/T3/T5/T6/T7 | ✅ |
| T4 | T2 | T2 → T4 | ✅ |
| T8 | T3, T4 | T3,T4 → T8 | ✅ |
| T13 | T5 | T5 → T13 | ✅ |
| T9 | T5, T6, T8, T13 | T5,T6,T8,T13 → T9 | ✅ |
| T10, T12, T16, T18, T19 | T8 | T8 → cada | ✅ |
| T11 | T5, T8 | T8 → T11 (+T5) | ✅ |
| T17 | T7, T8 | T8 → T17 (+T7) | ✅ |
| T14 | T9, T19 | T9,T19 → T14 | ✅ |
| T15 | T10, T11, T12, T16, T17, T18 | idem | ✅ |
| T20 | T15 | T15 → T20 | ✅ |
| T21 | T20 | T20 → T21 | ✅ |
| T22, T23, T25 | T21 | T21 → cada | ✅ |
| T24 | T22 | T22 → T24 | ✅ |
| T26 | T2, T21 | T21 → T26 (+T2) | ✅ |
| T27, T28 | anteriores | Fase 6 | ✅ |

**Testes × matriz do `TESTING.md`**:

| Task | Camada | Matriz exige | Task diz | Status |
| --- | --- | --- | --- | --- |
| T2, T3, T6, T7 | funções puras de domínio | unit | unit | ✅ |
| T4 | schema/migration | nenhum | none + build | ✅ |
| T5, T13 | engine Baileys (normalização/tradução pura) | unit na parte pura | unit | ✅ |
| T8 | mappers + repositórios com SQL/claim | unit + integration | unit + integration | ✅ |
| T9–T12, T16–T19 | use cases | unit | unit | ✅ |
| T14 | job (infra) + env | unit | unit | ✅ |
| T15 | rotas | nenhum (por ora) | unit com `inject` (acima do mínimo) | ✅ |
| T20–T26 | `app/` funções puras e componentes | unit | unit | ✅ |
| T1, T27 | documentos | nenhum | none | ✅ |

`integration-db` não é parallel-safe: só a T8 usa; se dividida, T8a e T8b rodam integração em sequência.

## Dependências externas (fora deste repositório)

| Item | Onde | Quem |
| --- | --- | --- |
| Planos `copysync-saver-{tier}-{mensal\|anual}` na aplicação `copysync` da central, com a permissão `SAVER_{TIER}` no snapshot | `pulsosocial_api` (produção = branch `feature/calibracao-backend`) | dono |
| Ofertas e checkout do Saver | Cakto | dono |
| `SAVER_EXTRACTION_WORKER_ENABLED=true` | Render | dono |

Até a central ter os planos, o Saver é liberado por concessão manual do super admin (`product-access` T16): dá para testar e operar com clientes piloto sem depender do checkout.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Regressão em menção a todos / participantes do chat | T5 não toca `getGroupParticipants`; smoke em T28 |
| Bloqueio de número | Ritmo, pausa, limite diário; smoke com conta real antes de abrir venda |
| Promessa de "nome" que o WhatsApp não entrega | T28 mede; vitrine (T26) só é publicada depois |
| Acoplamento ao Chat | Teste de independência em T15 |
| Base da plataforma com dado pessoal de terceiros (LGPD) | Código isola e audita; termos, base legal e retenção são decisão do dono antes de venda em escala (T27 registra) |
| Nome de um tenant aparecer no arquivo de outro | Nome no vínculo; teste de integração na T8 e de rota na T15 |
| D4 (aviso LGPD) e D5 (retenção) adiadas pelo dono | v1 não apaga nada sozinha; T31/T32 prontas para entrar; pendência escrita em `docs/saver.md` |
| `SAVER_MAX` sem teto de contatos | Exportação por stream (T17), lista por cursor, alerta em log |
| Liberação de exportar vazar entre tenants | FK composta + validação do alvo no use case (T18) + teste de integração na T4/T8 |
