# Uso dos recursos

Tela do super admin (`/admin/usage`, seção Plataforma) que responde "o que os clientes mais usam": ranking dos
recursos por **contas que usaram** e por volume, tendência contra o período anterior, quebra por plano, recursos
nunca usados no período e, por recurso, as contas que mais usam. Plano completo em
`.specs/features/usage-metrics/{spec,design,tasks}.md`.

## O que existe (P1 — api 0.102.0 · app 0.125.0)

- Só dado que já existe: as tabelas de domínio são lidas sob demanda (`source: "live"`). Sem tabela nova, sem
  instrumentação, sem analytics externo. Só dois índices e uma ação de auditoria.
- P2 (agregado diário `feature_usage_daily` + contador para Story e chat) e P3 (adoção, recorrência, retenção e
  visitas de tela) ainda não existem.

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
| contrato | `contracts/feature-usage/` | Fixtures lidas pelos testes dos dois lados (abaixo) |

## Rotas (só super admin; outro usuário = 401 `UNAUTHORIZED`)

| Rota | Devolve |
| --- | --- |
| `GET /admin/usage/summary` | `range` (com `maxDays`), `source`, `freshAt`, `population`, `totals`, `features[]`, `series` |
| `GET /admin/usage/features/:featureKey` | Item do recurso + série dele (`uses`, `activeTenants` por bucket) + `inScope` |
| `GET /admin/usage/features/:featureKey/tenants?cursor=` | Contas que mais usam, 25 por página (servidor decide), ordem `(uses desc, tenantId)` |

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
| `USAGE_METRICS_RANGE_INVALID` | 400 | `from > to`, data futura, período acima do teto da fonte (90 dias na P1). Formato, > 400 dias e `day` > 90 dias param antes, no schema (400 de validação) |
| `USAGE_METRICS_FEATURE_NOT_FOUND` | 404 | Chave fora do catálogo |
| `USAGE_METRICS_CURSOR_INVALID` | 400 | Cursor adulterado, vencido, de outro recurso ou de outro recorte; o painel recomeça com `CursorResetNotice` |
| `USAGE_METRICS_READ_UNAVAILABLE` | 503 | Orçamento de 2 s esgotado (inclusive na fila ou esperando conexão), `statement_timeout`, fila do portão cheia ou linhas acima da guarda. O painel mostra `Alert` com "Tentar de novo" (não a tela de serviço atualizando) |

## Catálogo (P1, 16 recursos)

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
- **Limitação conhecida:** com o tipo `ACCESS` marcado e período maior que 15 dias, o total anterior de contas fica sem
  base (`null`): o período anterior começa antes da retenção de 30 dias de `login_events` (`panel_login` tem dado).
  Some na P2, com o agregado diário.

## Auditoria e privacidade

- A 1ª página da lista de contas grava `USAGE_METRICS_VIEWED` com `{ kind: 'tenants', featureKey, filters, count }`
  (sem nome; id de conta só como "há filtro de conta"). A espera pela gravação é limitada a **500 ms**: falha ou
  demora vira log `warn` e a resposta segue. Resumo, detalhe e CSV não auditam (não têm nome de conta).
- Nome da conta só na lista do detalhe e no chip do filtro de conta (quando já carregado; senão "Conta <id curto>"),
  sempre sob a flag `usage.tenantName` (`Blurred`). Nunca persistido no navegador.
- CSV do resumo gerado no painel (BOM, `;`, neutralização de fórmula), sem nome de conta.

## Contrato (`contracts/feature-usage/`)

`summary.response.json`, `feature-detail.response.json`, `feature-tenants.response.json`, `catalog.json` e `README.md`.
O teste do catálogo da API compara `catalog.json` com `FEATURE_USAGE_CATALOG`; o teste do presenter compara as respostas
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

## Suposições conferidas no código

- **S1:** `SENT` só é gravado por `markResult`, e `updatedAt` = fim do envio; a linha não é tocada depois.
- **S2:** `AFFILIATE_SESSION_SYNCED` só é gravado quando o token mudou.
- **S3:** ofertas, envios, execuções do Caçador e `ai_usage_logs` não têm limpeza. `login_events` é podada em 30 dias e
  `link_clicks` em 90; vitrine e Gestor de Links são apagados de verdade pelo usuário.
- **S4/S5:** Story só deixa linha quando a IA escreve o título; `OUTBOUND` do chat não separa pessoa de automação
  (chat fica para a P2, com contador).

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
