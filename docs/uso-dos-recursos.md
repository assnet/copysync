# Uso dos recursos

Tela do super admin (`/admin/usage`, seção Plataforma) que responde "o que os clientes mais usam": ranking dos
recursos por **contas que usaram** e por volume, tendência contra o período anterior, quebra por plano, recursos
nunca usados no período e, por recurso, as contas que mais usam. Plano completo em
`.specs/features/usage-metrics/{spec,design,tasks}.md`.

## O que existe (P1 — api 0.102.0 · app 0.125.0)

- Só dado que já existe: as tabelas de domínio são lidas sob demanda (`source: "live"`). Sem tabela nova, sem
  instrumentação, sem analytics externo. Só dois índices e uma ação de auditoria.

## P2 — agregado diário e contador (api 0.103.0 · app 0.126.0)

- Tabela `feature_usage_daily` (dia de Brasília × conta × recurso × tipo → `uses`), consolidada por job no `worker`,
  e contador próprio para o que as tabelas de domínio não registram (Story e envio do chat). Com o agregado fresco e
  cobrindo o período, a leitura sai dele (`source: "daily"`) e o teto sobe para **400 dias**; senão segue a P1.
- **Só liga pela flag `FEATURE_USAGE_ROLLUP_ENABLED`** (default `false`). Sem ela nada muda: leitura sob demanda,
  teto de 90 dias. O contador grava desde o deploy, com ou sem a flag.

## P3 — adoção, recorrência, retenção e telas (api 0.104.0 · app 0.127.0)

- Por recurso no resumo: **adoção** (contas que usaram ÷ contas com direito hoje), **recorrência** (contas que usaram
  em ≥ N dias distintos, `recurringDays` 2/3/5, padrão 3) e **retenção** (contas do período anterior que voltaram).
- **Visitas de tela:** a conta registra que abriu uma tela do menu no dia; aba **Telas** em `/admin/usage`.
- Sem migration: visitas vão para `feature_usage_daily` (tipo `ACCESS`, chave `view:*`).

## Arquivos-chave

| Camada | Arquivo | Papel |
| --- | --- | --- |
| domain | `api/src/modules/metrics/domain/services/featureUsageCatalog.ts` | Catálogo fechado `FEATURE_USAGE_CATALOG` (chave, produto, família de plano, tipos, fonte, motivos possíveis de cobertura parcial, retenção) |
| domain | `.../domain/services/featureUsagePeriod.ts` | Período em `America/Sao_Paulo` → instantes UTC, período anterior, buckets dia/semana/mês, `dayInZone`, `dataFromOf` |
| domain | `.../domain/services/aggregateFeatureUsage.ts` | Toda a conta (filtros, alcance, tendência, por plano, série, nunca usados, top contas). Função pura |
| domain | `.../domain/contracts/IFeatureUsageReader.ts`, `IUsageTenantDirectory.ts`, `IUsageReadGate.ts` | Leitor de linhas, diretório de contas, portão de leitura |
| application | `.../application/use-cases/GetFeatureUsageSummaryUseCase.ts`, `GetFeatureUsageDetailUseCase.ts`, `ListFeatureUsageTenantsUseCase.ts`, `featureUsageTenantCursor.ts` | Resumo, detalhe, contas que mais usam (cursor keyset assinado, auditoria) |
| infra | `.../infrastructure/repositories/PrismaLiveFeatureUsageReader.ts`, `featureUsagePeriodSql.ts` | Uma instrução por fonte + `firstDataDays`; guarda de 100 mil linhas |
| infra | `.../infrastructure/repositories/PrismaUsageTenantDirectory.ts` | Contas, plano por família, conta interna, nomes (só a lista do detalhe) |
| infra | `.../infrastructure/repositories/featureUsageReadTimeout.ts` | Orçamento de 2 s, `runWithinBudget`, portão `usageReadGate` |
| infra | `.../infrastructure/featureUsageContainer.ts` | Factories |
| presentation | `.../presentation/routes/featureUsage.routes.ts`, `schemas/featureUsage.schema.ts`, `presenters/featureUsagePresenter.ts` | HTTP (`authHook` + `superAdminHook`) |
| erros | `api/src/shared/errors/internal/UsageMetricsErrors.ts` | Erros abaixo |
| painel | `app/src/features/featureUsage/` (`rules.ts`, `types.ts`, `strings.ts`, `hooks/`, `components/`), `app/src/services/adminUsage.service.ts`, `app/src/pages/admin/AdminUsagePage.tsx` | Tela, filtros, fila de leituras |
| P2 domain | `.../domain/contracts/IFeatureUsageDailyRepository.ts`, `IFeatureUsageRollupStateRepository.ts`, `IFeatureUsageRecorder.ts` | Agregado, marco/corte, contador fail-open |
| P2 application | `.../application/use-cases/RollupFeatureUsageUseCase.ts`, `RecordFeatureUsageUseCase.ts` | Consolidação e contador |
| P2 infra | `.../infrastructure/repositories/PrismaFeatureUsageDailyRepository.ts`, `PrismaDailyFeatureUsageReader.ts`, `PrismaFeatureUsageRollupStateRepository.ts`, `jobs/FeatureUsageRollupJob.ts`, `featureUsageRollupStart.ts` | `replaceDay`/`increment`/`markOnce`, leitura do agregado, `platform_settings`, job |
| P3 | `.../domain/services/featureEligibility.ts`, `featureUsageRetention.ts`, `screenViewCatalog.ts`; `.../application/use-cases/GetFeatureUsageScreensUseCase.ts`, `RecordPageViewUseCase.ts`; `.../infrastructure/repositories/PrismaFeatureEligibilityReader.ts`, `PrismaPageViewReader.ts`; `.../presentation/routes/usagePageViews.routes.ts` | Direito, adoção/recorrência/retenção, telas |
| P3 painel | `featureUsage/screenViews.ts`, `hooks/usePageViewReporter.ts`, `hooks/useUsageScreens.ts`, `components/ScreensTab.tsx`, `RatioValue.tsx`, `app/src/services/usagePageViews.service.ts` | Envio de visita, aba Telas, adoção na matriz/ranking |
| contrato | `contracts/feature-usage/` | Fixtures lidas pelos testes dos dois lados (abaixo) |

## Rotas (só super admin; outro usuário = 401 `UNAUTHORIZED`)

| Rota | Devolve |
| --- | --- |
| `GET /admin/usage/summary` | `range` (com `maxDays`), `source`, `freshAt`, `population`, `totals`, `features[]`, `series` |
| `GET /admin/usage/features/:featureKey` | Item do recurso + série dele (`uses`, `activeTenants` por bucket) + `inScope` |
| `GET /admin/usage/features/:featureKey/tenants?cursor=` | Contas que mais usam, 25 por página (servidor decide), ordem `(uses desc, tenantId)` |
| `GET /admin/usage/screens` (P3) | `range`, `firstDataDay`, `population.tenants`, `screens[]` (`key`, `product`, `planFamily`, `tenants`, `tenantDays`) |
| `POST /usage/page-views` (P3, rota da **conta**) | 204; marca a tela do dia (ver "Visitas de tela") |

Query comum: `from`, `to` (`YYYY-MM-DD`, inclusivos, Brasília), `granularity`, `product`, `kind` (lista), `plan`,
`tenantStatus`, `includeInternal`, `tenantId`. Padrões no schema (pedido sem query): últimos 30 dias, `day` até 31 dias
e `week` acima, `kind = ACTION,AUTOMATIC`, `tenantStatus = ACTIVE`, internas excluídas. O painel envia tudo explícito.

**Fora do recorte:** recurso cujo tipo ou plano não cruza o filtro responde 200, sem banco: o detalhe vem **zerado com
`inScope: false`** e a lista vem `{ items: [], nextCursor: null }` (sem `inScope`, sem auditoria). 404 só para chave fora
do catálogo.

**Cursor da lista:** amarrado ao recurso, ao recorte e às **datas resolvidas** do período. Virar o dia (preset "30 dias"
passa a cobrir outras datas) invalida a página seguinte: 400 `USAGE_METRICS_CURSOR_INVALID` e o painel recomeça do
início com aviso.

## Erros

| Código | HTTP | Quando |
| --- | --- | --- |
| `USAGE_METRICS_RANGE_INVALID` | 400 | `from > to`, data futura, período acima do teto da fonte (90 dias sob demanda, 400 no agregado; `day` até 90). Formato, > 400 dias e `day` > 90 dias param antes, no schema (400 de validação) |
| `USAGE_METRICS_FEATURE_NOT_FOUND` | 404 | Chave fora do catálogo |
| `USAGE_METRICS_CURSOR_INVALID` | 400 | Cursor adulterado, vencido, de outro recurso ou de outro recorte; o painel recomeça com `CursorResetNotice` |
| `USAGE_METRICS_READ_UNAVAILABLE` | 503 | Orçamento de 2 s esgotado (inclusive na fila ou esperando conexão), `statement_timeout`, fila do portão cheia, linhas acima da guarda ou agregado velho (> 45 min) com período acima de 90 dias. O painel mostra `Alert` com "Tentar de novo" (não a tela de serviço atualizando) |

## Catálogo (16 recursos da P1 + `chat_send` da P2)

`tipo`: **ação** (alguém fez), **automático** (o sistema trabalhou pela conta), **audiência** (terceiro clicou),
**acesso** (entrou no painel). O tipo é do **evento**: o Caçador tem linhas `ACTION` (manual) e `AUTOMATIC` (agendada).

| Chave | Conta como uso | Fonte | Tipo | Parcial (código) |
| --- | --- | --- | --- | --- |
| `offer_generator` | oferta criada, `origin = GENERATOR` | `offers.createdAt` | ação | — |
| `group_monitoring` | oferta criada, `origin = MONITORING` | `offers.createdAt` | automático | — |
| `offer_hunter` | execução do Caçador, menos `SKIPPED` | `offer_hunt_runs.startedAt` | ação/automático por `trigger` | — |
| `offer_dispatch` | envio `SENT` de qualquer origem | `offer_dispatches.updatedAt` | automático fixo | `MIXED_TRIGGERS` |
| `ai_rewrite` | IA com sucesso, `purpose = offer.text` | `ai_usage_logs.createdAt` | automático fixo | `MIXED_TRIGGERS` |
| `offer_story` | título de story pela IA (`offer_story_headline`) | `ai_usage_logs.createdAt` | ação | `AI_HEADLINE_ONLY` |
| `link_rotation` | link criado | `link_rotations.createdAt` | ação | `EXISTING_ONLY` |
| `link_rotation_click` | clique | `link_clicks.createdAt` | audiência | `EXISTING_ONLY`, `RETENTION` (90 d) |
| `storefront` | oferta na vitrine (rascunho ou publicada) | `storefront_offers.createdAt` | ação | `EXISTING_ONLY` |
| `affiliate_credentials` | credencial ou etiqueta salva | `audit_logs` `AFFILIATE_CREDENTIAL_UPSERTED` | ação | `MIXED_EVENTS` |
| `extension_sync` | troca de token pela extensão | `audit_logs` `AFFILIATE_SESSION_SYNCED` | ação | `TOKEN_CHANGE_ONLY` |
| `whatsapp_session` | sessão criada, `engine <> telegram` (inclui removidas) | `sessions.createdAt` | ação | — |
| `telegram_session` | sessão criada, `engine = telegram` | `sessions.createdAt` | ação | — |
| `saver_extraction` | extração pedida | `saver_extractions.createdAt` | ação | — |
| `saver_export` | exportação concluída (`meta.completed = true`) | `audit_logs` `SAVER_EXPORTED` | ação | — |
| `panel_login` | `LOGIN_OK` ou `LOGIN_CODE_VERIFIED`, conta via `user_tenants` | `login_events.createdAt` | acesso | `RETENTION` (30 d) |
| `chat_send` (P2) | envio do painel aceito (`origin = PANEL`) | contador (`feature_usage_daily`) | ação | — |

`offer_story` na P2: antes do corte, `ai_usage_logs`; do corte em diante, contador (arte gerada, com ou sem título).

O que cada parcial realmente mede: `offer_dispatch` e `ai_rewrite` contam como automático mas incluem o que foi
disparado à mão (a fonte não separa; "só ação" não os mostra, exceção D11); `offer_story` só conta Story cujo título a
IA escreveu; `link_rotation`, `link_rotation_click` e `storefront` só o que o usuário não apagou (apagar é de verdade,
com cascade nos cliques); `affiliate_credentials` mistura credencial e etiqueta do Mercado Livre; `extension_sync` só
grava quando o token mudou (subestima a extensão); `RETENTION` aparece quando o período começa antes de hoje menos a
retenção da fonte. A resposta traz só os motivos que valem para o período pedido (`coverageReasons`; `coverage =
PARTIAL` quando sobra algum). O painel tem um texto por código.

**`meta.completed`:** métrica nunca lê conteúdo (texto, nome, telefone, link, título, e-mail, IP, `meta`). A única
exceção é o booleano `meta.completed` de `SAVER_EXPORTED`, porque a auditoria é gravada no `finally`, também quando a
exportação falha. `userId` de `login_events` só faz o join com `user_tenants` e não sai da consulta.

## Medidas

- **Usos:** eventos **de um recurso** no período. **Não há total de usos** (`totals.uses` não existe): os recursos medem
  etapas diferentes da mesma oferta (criação em `offers`, envio em `offer_dispatches`) e somar contaria duas vezes.
- **Contas que usaram** (medida que ordena por padrão; o automático tem centenas de vezes mais eventos que o manual).
- **Alcance:** contas que usaram ÷ contas do recorte na família de planos do recurso (0 com recorte vazio).
- **Tendência:** contra o período anterior de mesma duração; `null` ("sem base") quando o anterior começa antes de
  `dataFrom` do recurso. `firstDataDay` = primeiro dado real (mesmo filtro da consulta, `MIN` sem período; é o "dados
  desde"); `dataFrom` = o maior entre ele e hoje menos a retenção.
- **Total anterior de contas** (`totals.activeTenantsPrevious`): `null` só quando algum recurso do recorte **com dado**
  não tem base; recurso que nunca teve dado (ex.: Telegram sem conta) não anula o total.
- **Contas ativas:** distintas entre recursos. **Recursos usados:** "x de N", N = recursos cujos tipos cruzam o filtro.
- **Recorte por tipo:** recurso cujos `kinds` não cruzam o filtro `kind` some de `features[]`, de nunca usados, de
  `featuresUsed` e de `topFeature`. No padrão (ação + automático) `panel_login` e `link_rotation_click` não aparecem.
- **Planos:** duas famílias. Afiliados (Afiliados, Chat, sessão, acesso) = `Tenant.planSlug` só com Afiliados ativo hoje
  (`resolveProductAccess`), senão `NONE`; Saver = `tenant_products(SAVER).planSlug` ativo, senão `NONE`. Em cada família
  cada conta conta uma vez; as famílias não se somam. Filtro de plano restringe contas **e** recursos à família dele.
  Plano e status são os de **hoje**.
- **Conta interna:** tem membro `isSuperAdmin`; excluída por padrão (`population.internalExcluded`).

## Fuso, período e limites

- Dia em `America/Sao_Paulo` no próprio SQL: `to_char((("col" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date,
  'YYYY-MM-DD')` (dois `AT TIME ZONE`; dia sempre texto). Período pela coluna crua contra instantes UTC (usa índice).
- Teto de 90 dias na P1 (`range.maxDays`); `day` só até 90 dias. "Hoje" e presets do painel usam `serverNow()`.
- **Orçamento de 2 s por pedido**, contado desde a chegada ao portão: fila, fontes, primeiro dado e diretório gastam o
  mesmo tempo. Cada ida ao banco é uma transação com `SET LOCAL statement_timeout` = o que resta (< 1 ms não vai ao
  banco) e corre contra um temporizador que cobre a espera por conexão.
- **Instruções em sequência** (13 idas por resumo/detalhe; a lista faz mais uma para os nomes), nunca `Promise.all`: o
  pool tem `connection_limit=5` e o Prisma não cancela a consulta abandonada; em sequência fica no máximo uma órfã.
- **Uma leitura de uso por processo** (`usageReadGate`, semáforo de 1 vaga). Uma segunda leitura ao mesmo tempo (outra
  aba, outro super admin) **espera** em fila FIFO de até 4 pedidos, dentro do próprio orçamento de 2 s; fila cheia ou
  tempo esgotado na espera = 503 "tentar de novo". A vaga só volta quando todas as instruções do pedido terminam
  (inclusive a órfã), com um teto: **30 s depois do fim do orçamento** a vaga volta mesmo com consulta órfã pendente,
com log `warn` (evita portão preso por socket morto). Por isso a `DATABASE_URL` da Render deve ter `socket_timeout`.
Assim a feature ocupa no máximo 1 das 5 conexões. Com mais de uma réplica `http` o limite é por
  réplica. É limitador de concorrência local, não estado operacional: reinício o zera sem perda.
- **Painel:** fila única de leituras por aba (`adminUsage.service.ts`): um pedido em voo; pedido na fila de um canal
  (`summary`, `trend`, `detail`, `tenants`) é substituído pelo mais novo do mesmo canal; mesma chave reaproveita a
  promessa. A lista de contas só é pedida depois do detalhe. Timeout de 8 s em cada leitura de uso; a fila é limpa no
logout. Sem retry automático.
- Guarda de 100 mil linhas na leitura sob demanda (acima = 503).
- **Limitação conhecida:** sob demanda, com o tipo `ACCESS` marcado e período maior que 15 dias, o total anterior de
  contas fica sem base (`null`): o período anterior começa antes da retenção de 30 dias de `login_events`. O agregado
  guarda o dia consolidado por 400 dias, então a limitação some à medida que o job acumula histórico (o backfill não
  recupera o que `login_events` já podou).

## Agregado diário (P2)

**Tabela `feature_usage_daily`:** PK `(day, tenantId, featureKey, kind)`, `uses int`, `updatedAt` (sem default; SQL cru
grava). Índices `(featureKey, day)` e `(tenantId)`; FK para `tenants` com `ON DELETE CASCADE`. Só conta, chave, tipo e
número: nada de usuário, conteúdo ou destino.

**Job `FeatureUsageRollupJob`** (`infrastructure/jobs/`, use case `RollupFeatureUsageUseCase`), só `worker`/`all` com
`FEATURE_USAGE_ROLLUP_ENABLED=true` (`featureUsageRollupStart.ts`; papel `http` nunca monta). `start()` só arma o timer:
**o 1º tick roda 15 min depois do boot**, nada no boot. Tick de 15 min, não reentra, nunca lança.

**Grupos de fonte:** recursos lidos numa mesma instrução formam um grupo (id = chaves unidas por `+`). Cada grupo anda
sozinho: erro persistente num grupo não trava a marca, o frescor nem o backfill dos outros. Em cada tick:

1. Lease `feature-usage-rollup` (TTL 10 min, solto ao terminar). **Renovado** antes de cada leitura de fonte e de
   cada gravação de dia; renovação recusada = log `feature usage rollup lost lease, tick aborted` e nada mais é gravado.
2. **Reprocesso** (`retryQueue`, itens dia × grupo que falharam e ficaram atrás da marca): cada item é relido sozinho
   (isola o dia ruim); deu certo, sai. **No máximo 30 itens**; cheia, os mais antigos saem com log `error`
   `feature usage rollup retry queue full, oldest dropped` e o menor dia descartado vira o **piso de reprocesso** do
   grupo (`groups[].reprocessFrom`).
3. **Janela recente** (`recentWindow`): de `finalizedThrough + 1` (sem marca: ontem) até hoje, **no máximo 7 dias por
   tick** (job parado por dias alcança hoje em vários ticks), nunca antes da retenção, grupo a grupo. `replaceDay`
   regrava, numa transação por dia, só as chaves `LIVE` do dia (as do contador nunca são tocadas).
   `finalizedThrough` avança **se algum grupo deu certo** (todos falhando = nada anda), **nunca além de anteontem**
   (ontem é sempre recalculado); o (dia, grupo) que falhou e ficou atrás da marca entra no reprocesso.
4. **Revisita leve:** **1 dia por tick**, em rodízio para trás de hoje − 2 até hoje − 30 (`revisitCursor`), só dia já
   finalizado; recalcula cada grupo e loga `warn` `feature usage rollup revisit changed a finalized day` se a soma
   mudou (dado que chegou depois de D+2). **Piso de reprocesso:** grupo com `reprocessFrom` recalcula **1 dia por
   tick** do piso para frente; ao entrar na faixa da revisita (≥ hoje − 30) ou passar da marca, o piso some.
5. **Backfill por grupo** (lease `feature-usage-backfill`, TTL 10 min, solto): ≤ 7 dias por tick, para trás a partir
   do `groups[].backfillCursor` (começa anteontem; o cursor único legado `backfillCursor` só vale no estado antigo, sem
   `groups`; grupo novo começa de anteontem). Falha = o cursor não anda (o passo se repete, idempotente). O grupo
   termina ao passar do seu primeiro dado (`FIRST_DATA`) ou do teto de 400 dias (`RETENTION`). O **marco**
   (`backfillCompletedAt`, `backfilledFrom`, `backfillStopReason`) é gravado uma vez quando todos os grupos terminaram
   ou os que faltam falharam **3+ passos seguidos**: esses ficam em `backfillPendingKeys` e continuam tentando (saem
   ao concluir). A leitura trata recurso pendente como **não coberto** pelo agregado.
6. **Retenção:** apaga `day < hoje − 400`, 1×/24 h (lease `feature-usage-retention` de 24 h, não solto).

**Falhas e frescor:** `groups[].failureStreak` por grupo (janela, reprocesso ou piso) e `failureStreak` do tick; a
partir de **3**, log `error` (`feature usage rollup group failing repeatedly` / `feature usage rollup failing
repeatedly`). Frescor do grupo (`groups[].lastSuccessAt`) só quando a janela chegou a hoje **sem falha do grupo na
janela**, **sem item do grupo pendente no reprocesso** e sem falha no backfill dele (o piso de reprocesso não tira o
frescor). `lastSuccessAt` global só quando o tick inteiro concluiu; é o frescor do estado antigo, sem grupos.

**Estado completo** (marca, `failureStreak`, `lastSuccessAt`, `groups` com cursor/marco/falhas/frescor/piso por grupo,
`retryQueue`, `revisitCursor`, marco e `backfillPendingKeys`) em `platform_settings["feature_usage_rollup"]`, nunca em
memória. Orçamento de 20 s por leitura de fonte no job (fora do portão do `http`).

**Escolha da fonte (`chooseUsageSource`):** o agregado cobre o período quando o marco existe e (`FIRST_DATA`) ou o
período começa em `backfilledFrom` ou depois (`RETENTION`), e nenhum recurso `LIVE` pedido está em
`backfillPendingKeys`. Só vale **fresco**: o **menor frescor dos grupos dos recursos pedidos** (`usageFreshAt`;
recurso sem grupo no estado usa o `lastSuccessAt` global; só recurso do contador = tick mais recente) há menos de
**45 min**. Cobre mas está velho ou pendente: até 90 dias lê a fonte viva com log `warn`
(`feature usage daily aggregate stale, reading live sources` / `... pending backfill, ...`); acima de 90 dias, 503
`USAGE_METRICS_READ_UNAVAILABLE` (nunca agregado velho ou incompleto em silêncio). A resposta traz `source`
(`daily`/`live`), `freshAt` e `range.maxDays` (400 ou 90). Granularidade `day` segue limitada a 90 dias.

**Corte no SQL:** `replaceDay` cria a linha `platform_settings["feature_usage_cutover"]` vazia se ainda não existe
(`ON CONFLICT DO NOTHING`, `"updatedAt"` explícito) e a trava com `FOR SHARE` na mesma transação, antes de tocar
`feature_usage_daily`; `DELETE`/`INSERT` ainda pulam a chave cujo corte já vale no dia. Assim o `claimCutover` espera a
transação em curso desde o **primeiro** corte. Sem deadlock: a transação trava sempre a linha dos cortes antes do
agregado e o `claimCutover` (instrução única) só trava a linha dos cortes.

## Contador (P2)

- `IFeatureUsageRecorder` / `RecordFeatureUsageUseCase`: `increment` (+1 no dia × conta × recurso × tipo). Quem chama
  usa `recordFeatureUsage(...)`: **fail-open**, sem `await`, erro vira log `warn` (sem conta nem conteúdo). Teto de
  **20 gravações em voo por processo**; acima o uso é descartado, com aviso amostrado 1×/min com a contagem.
- **`chat_send`** (novo, `RECORDED`, `FIRST_WRITE`, produto Chat): só envio com `origin = PANEL` (pessoa no painel) e
  **aceito pela engine com id externo**: texto em `SendMessageUseCase`; mídia no despacho (`DispatchOutboundMediaUseCase`),
  na transição `PENDING → SENT` que de fato ocorreu (retry duplicado não soma) e só com id externo não vazio devolvido
  pela engine. Enfileirar a mídia não conta. `AUTOMATION` (oferta) não conta; `origin` é obrigatório em
  `SendMessageUseCase`/`SendMediaMessageUseCase` e segue no job da mídia. Conta desde a primeira escrita.
- **Descartes (`DROPPED`):** uso descartado pelo teto de 20 em voo é somado por dia × recurso e gravado em
  `platform_settings["feature_usage_dropped"]` em lote, **no máximo 1×/min por processo** (`addDrops`, soma no SQL;
  dia com mais de 400 dias sai). O motivo de cobertura `DROPPED` só aparece quando houve descarte **dentro do período**
  pedido, em dia do contador.
- **`offer_story`** (`LIVE` com `recordedFrom: CUTOVER`): arte gerada = 1 uso, com ou sem título da IA.
- **Corte** em `platform_settings["feature_usage_cutover"]` (`{ "<chave>": "YYYY-MM-DD" }`), gravado uma vez e de forma
  atômica na **primeira escrita** do contador: corte = **dia seguinte** (Brasília) a ela. Antes do corte o Story vem da
  fonte viva (`ai_usage_logs`, parcial `AI_HEADLINE_ONLY`); do corte em diante, do contador, e o rollup nunca grava dia
  ≥ corte. O corte nunca muda.
- **Aviso:** qualquer processo que escreva no banco de produção grava o corte na primeira escrita — inclusive um
  servidor local com `api/.env` (aponta para produção). **Nunca rodar a API local contra produção.**

## Painel (P2)

- Linha de contexto com a fonte: `live` sempre indicada; `daily` mostra "atualizado há X" e aviso de dado antigo
  acima de **30 min** (`USAGE_DAILY_STALE_MS`, antes do corte de 45 min da API). Hora pelo `serverNow()`.
- Presets `180d` e `365d` aparecem quando `range.maxDays` permite (`usageMaxDays.ts`).
- Leitura lenta (503) com período acima de 90 dias: o aviso oferece **"Usar 90 dias"** (volta ao preset `90d`, que a
  leitura sob demanda atende) além de "Tentar de novo".

## Ligar na Render (checklist)

1. Deploy com as migrations `20261117170000_create_feature_usage_daily` e
   `20261117173000_add_feature_usage_daily_tenant_index` (boot do container).
2. `DATABASE_URL` com `socket_timeout` (portão de leitura e job).
3. `FEATURE_USAGE_ROLLUP_ENABLED=true` **só no `worker`** (nunca no `http`).
4. Depois de ~15 min, conferir o 1º tick (sem `lost lease`/`failing repeatedly`/`group failing repeatedly`),
   `finalizedThrough` e `groups[].lastSuccessAt` em `platform_settings["feature_usage_rollup"]`; `retryQueue` vazia ou
   curta.
5. Acompanhar o backfill (`groups[].backfillCursor` andando 7 dias por tick) até o log
   `feature usage backfill completed` e o marco (`backfilledFrom`, `backfillStopReason`, `backfillPendingKeys` vazio).
   Só então a tela passa a `source: daily` e a 400 dias (recurso em `backfillPendingKeys` segue sob demanda).

## Adoção, recorrência e retenção (P3)

- **Direito ao recurso** (`domain/services/featureEligibility.ts`, leitura `PrismaFeatureEligibilityReader.ts`: uma
  instrução para todas as contas, sem nome): produto ativo hoje pela linha do **produto fonte** (`accessSourceOf` +
  `resolveProductAccess`; `CHAT` segue `AFFILIATES`; `SESSION`/`ACCESS` sem produto) e, quando houver, o entitlement
  de `FEATURE_ENTITLEMENT_KEYS` (vitrine, Story e Caçador só `true`; `ai_rewrite` só `false` explícito bloqueia;
  `telegram_session` ausente/`null` = ilimitado, número > 0 libera). Conta sem a chave usa o preset do plano.
  Caçador exige também `offer_hunter_finds_per_day > 0` (ausente = 0). Audiência **"Só super admin"**
  (`platform_settings["feature_audience"]`, Caçador e Saver): só conta interna tem direito. `INTERNAL_ONLY_FEATURES`
  (hoje `chat_send`, menu do Chat só de super admin): só conta interna; a lista está no contrato
  (`internalOnlyFeatures`) e o teste do menu no painel confere o `superAdminOnly` do Chat.
- `featureUsageRetention.ts` (puro): adoção limitada a 1 e `null` com 0 contas com direito; quem usou sem direito hoje
  entra no numerador (`usedWithoutEligibility`, interno); retenção `null` sem período anterior completo (mesma regra
  da tendência). Item do resumo: `eligibleTenants`, `adoption`, `recurringTenants`, `retainedTenants` (no detalhe
  saem `null`). A leitura do direito é mais uma instrução, em sequência, no mesmo orçamento e na mesma vaga.
- `GET /admin/usage/summary?recurringDays=2|3|5` (outro valor = 400 de validação). Fora do cursor da lista.

## Visitas de tela (P3)

- Lista fechada `screenViewCatalog.ts` (**15 telas**, chave `view:<chave do item do menu>` de `buildNavigation`; telas
  do super admin e o Chat ficam de fora). Fora de `FEATURE_USAGE_CATALOG`: nunca entra no resumo nem no rollup; conta
  desde a primeira escrita (sem corte); primeiro dado = `MIN(day)`. Painel espelha em `featureUsage/screenViews.ts`.
- `POST /usage/page-views` `{ key }` (rota da conta, `authHook` + `tenantHook`, classe `TENANT`, fora do gate de
  produto): chave fora da lista = 400; **60/min por conta**; sempre 204. `RecordPageViewUseCase` → `markOnce`:
  **idempotente por dia × conta × tela** (repetir não soma), tipo `ACCESS`, fail-open. **Super admin não grava.**
  Nada de usuário, URL ou IP.
- Painel: `usePageViewReporter` no `AppLayout`, no máximo uma chamada por dia (Brasília, `serverNow()`) × conta × tela
  por aba (marcas em `sessionStorage`), não envia para super admin; 429/rede ignorados.
- `GET /admin/usage/screens` (super admin): uma linha por tela (`tenants`, `tenantDays`), sem conta; consulta própria
  agregada no banco, sempre do agregado (teto 400 dias), mesmo portão/orçamento; recorte de contas igual ao resumo e
  filtro de produto (o de tipo não vale). `population.tenants` = contas do recorte; `population.byFamily` = contas do
  recorte por família de plano: o "Do recorte" de tela Saver divide pela família Saver, as demais pela de Afiliados.
- Aba **Telas** (`ScreensTab.tsx`, `useUsageScreens.ts`) ordena por contas que abriram e cruza "abriu × usou" pelo
  `SCREEN_FEATURE` (`rules.ts`; telas sem recurso único ficam de fora), com aviso de coleta ("coleta desde"/parcial).
  **Teto próprio de 400 dias** nos presets (o da rota), sem herdar o teto nem o reset de período do resumo; o resumo
  da coluna cruzada é lido só com a tabela aberta e tem estado próprio (carregando/falhou).

## Auditoria e privacidade

- A 1ª página da lista de contas grava `USAGE_METRICS_VIEWED` com `{ kind: 'tenants', featureKey, filters, count }`
  (sem nome; id de conta só como "há filtro de conta"). A espera pela gravação é limitada a **500 ms**: falha ou
  demora vira log `warn` e a resposta segue. Resumo, detalhe e CSV não auditam (não têm nome de conta).
- Nome da conta só na lista do detalhe e no chip do filtro de conta (quando já carregado; senão "Conta <id curto>"),
  sempre sob a flag `usage.tenantName` (`Blurred`). Nunca persistido no navegador.
- CSV do resumo gerado no painel (BOM, `;`, neutralização de fórmula), sem nome de conta.

## Contrato (`contracts/feature-usage/`)

`summary.response.json`, `feature-detail.response.json`, `feature-tenants.response.json`, `summary.daily.response.json` e
`feature-detail.daily.response.json` (P2, `source: daily` com `freshAt`), `screens.response.json` (P3), `catalog.json`
(com `screenKeys` e `internalOnlyFeatures`) e `README.md`.
O teste do catálogo da API compara `catalog.json` com `FEATURE_USAGE_CATALOG` (e o de elegibilidade,
`internalOnlyFeatures` com `INTERNAL_ONLY_FEATURES`); o teste do menu do painel amarra o Chat `superAdminOnly` a ela; o teste do presenter compara as respostas
com os exemplos; os testes do painel exigem texto para cada chave e código e validam os exemplos contra `types.ts`.
Leitura por caminho (`fs`), sem import entre `api/` e `app/`, fora de build e imagem. **Mudou o contrato, muda a
fixture no mesmo commit.**

## Migrations e índices

- `20261117150000_add_audit_action_usage_metrics` — `USAGE_METRICS_VIEWED` no enum `AuditAction`.
- `20261117160000_add_usage_read_indexes` — `offers(createdAt)` e `offer_dispatches(status, updatedAt)`, com
  `IF NOT EXISTS`. Os índices antigos começam por `tenantId` e não servem filtro só por período. As demais fontes são
  pequenas e lidas por varredura; `MIN` do primeiro dado em `login_events`/`ai_usage_logs` levou ~6–7 ms com 200 mil
  linhas (cache quente), sem índice novo.
- **Tempo de criação medido** (Postgres 16 local, Apple M5, linhas sintéticas; Render não medido): `offer_dispatches`
  com 250 mil linhas **64–74 ms**; `offers` com 60 mil linhas **10 ms**. Abaixo de 2 s, então migration normal no boot.
  Se a base crescer e a medição passar de 2 s (a migration sem `CONCURRENTLY` bloqueia escrita do worker de envio),
  criar antes do deploy, na Render, com `CREATE INDEX CONCURRENTLY IF NOT EXISTS` com os mesmos nomes; a migration
  vira no-op.

- `20261117170000_create_feature_usage_daily` (P2) — tabela `feature_usage_daily`, índice `(featureKey, day)`, FK com cascade.
- `20261117173000_add_feature_usage_daily_tenant_index` (P2) — índice `(tenantId)` (cascade da conta e leitura por conta).
  Tabela nova e vazia: migration normal no boot.

## Suposições conferidas no código

- **S1:** `SENT` só é gravado por `markResult`, e `updatedAt` = fim do envio; a linha não é tocada depois.
- **S2:** `AFFILIATE_SESSION_SYNCED` só é gravado quando o token mudou.
- **S3:** ofertas, envios, execuções do Caçador e `ai_usage_logs` não têm limpeza. `login_events` é podada em 30 dias e
  `link_clicks` em 90; vitrine e Gestor de Links são apagados de verdade pelo usuário.
- **S4/S5:** Story só deixa linha quando a IA escreve o título; `OUTBOUND` do chat não separa pessoa de automação
  (resolvido na P2: `chat_send` pelo contador com `origin`).

## O que não fazer

- Somar usos de recursos diferentes; listar como nunca usado recurso fora do filtro de tipo; tratar tipo como atributo
  fixo do recurso (fora `ai_rewrite`/`offer_dispatch`); somar as duas famílias de plano; tratar `planSlug` como prova
  de plano ativo.
- Ler conteúdo ou `meta` (fora `meta.completed`); consulta de uso sem `tenantId` no `GROUP BY` (só `firstDataDays`);
  `count(*)` sem `::int`; dia como `date` ou com um só `AT TIME ZONE`; `Date.now()` do navegador para "hoje".
- Rodar as instruções em paralelo, uma transação para todas, `statement_timeout = 0`, confiar no `statement_timeout`
  para a espera por conexão; aumentar a fila do portão ou guardar resultado/contagem em memória (cache = estado
  operacional, `docs/arquitetura-escala.md`).
- Nome de conta fora da lista do detalhe; lista sem cursor assinado; aceitar `limit`/`offset`.
- Mudar o contrato sem atualizar `contracts/feature-usage/`; rótulo fora de `featureUsage/strings.ts`; marca em chave,
  rota ou função; renomear recurso para caber no gráfico.
- Chamar a Render, APM, `/metrics` público, analytics externo; biblioteca nova de gráfico, data ou i18n.
- Editar migration aplicada; rodar `prisma migrate deploy` fora da Render.
- P2: ligar `FEATURE_USAGE_ROLLUP_ENABLED` no `http`; gravar recurso do contador pelo rollup (ou dia ≥ corte); servir
  agregado com mais de 45 min; `await` no contador ou deixá-lo falhar o envio; contar envio de automação ou não aceito
  em `chat_send` (mídia: nunca no enfileiramento, só no `SENT` com id externo); editar/apagar o corte em
  `platform_settings`; rodar a API local contra produção (grava o corte); tirar a criação da linha de cortes ou o
  `FOR SHARE` do `replaceDay`; travar `feature_usage_daily` antes da linha de cortes; dar frescor a grupo com item no
  reprocesso; descartar item do reprocesso sem gravar o piso (`reprocessFrom`).
- P3: tela fora de `screenViewCatalog.ts` (painel e API mudam juntos, com `catalog.json`); gravar visita de super admin,
  usuário, URL ou IP; somar visitas repetidas do dia; tela `view:*` no resumo ou no rollup; adoção por plano em vez do
  produto fonte + entitlement; reescrever `resolveProductAccess`.
