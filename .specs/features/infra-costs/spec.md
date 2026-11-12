# Custos da infraestrutura pelo super admin — Spec

**Fonte:** pedido do dono em 2026-11-12. Base: [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md) §5.1 (planos e escada
da Render), [`docs/workers-escala.md`](../../../docs/workers-escala.md) (capacidade por plano, escala de réplicas),
[`docs/ops-metricas.md`](../../../docs/ops-metricas.md) (coletor, regra "rota nunca chama a Render"),
[`docs/ia-provedores.md`](../../../docs/ia-provedores.md) (`ai_usage_logs`), [`docs/planos.md`](../../../docs/planos.md) (preço só no `catalog.ts`).
**Tamanho:** Large. Desenho em [`design.md`](design.md); tarefas em [`tasks.md`](tasks.md). **Status:** Draft, aguarda aprovação do dono.

## Problema

O CopySync roda em 5 serviços da Render (Oregon) mais R2, IA da plataforma e e-mail da central. O custo de cada um está
espalhado: preço no painel da Render, número de réplicas do worker que muda com a escala, uso de IA em `ai_usage_logs`,
R2 no painel da Cloudflare. Ninguém sabe quanto custa **uma sessão**, **um cliente** ou **um plano**, nem se o LITE
(R$ 97) paga a própria infraestrutura. Com a escala por réplica (`/admin/workers/scale`) o custo passa a variar no mês.

Serviços em 2026-11-12 (dados do painel da Render enviados pelo dono; ids ficam fora do git, só na env do `worker`, D3):

| Serviço | Tipo | Plano | US$/mês | Componente à parte |
| --- | --- | --- | --- | --- |
| `copysync_api` | Web Service, Docker, `PROCESS_ROLE=http` | 1 CPU/2 GB | 25 | **disco 15 GB** × US$ 0,25 = US$ 3,75 (mantido: o chat pode usar; só cresce). Com disco a Render não escala o serviço |
| `copysync_worker` | Private Service, Docker, `PROCESS_ROLE=worker` | 1 CPU/2 GB, **por instância** | 25 × N | — (hoje 2 instâncias por causa do teste T25; normalmente 1). Autoescala nativa exige workspace Pro: não usada |
| `copysync_app` | Static Site | — | 0 | — |
| `copysync-redis` | Key Value (Valkey 8) | 1 GB / 1.000 conexões | 20 | — |
| `db-copysync-postgres` | PostgreSQL 18, sem HA | 0.5 CPU/1 GB | 19 | **armazenamento 15 GB** × US$ 0,30 = US$ 4,50, sem autoescala de storage |
| Workspace Render | Hobby | inclui 5 GB de banda e 500 min de build | 0 | **excedente entra na conta**: banda US$ 0,15/GB (métrica da Render), build US$ 5 por 1.000 min; tráfego interno na região é grátis; sem taxa por membro |
| Cloudflare R2 | mídia (`MEDIA_STORAGE_DRIVER=s3`) | por GB e por operação | 0 hoje (item manual editável) | — |
| IA da plataforma | provedores do super admin | por token | variável | — |
| E-mail | central (PulsoSocial), SMTP do domínio | — | 23 | custo do CopySync |

Preços de render.com/pricing (2026-11-12); cobrança proporcional por segundo: instância extra = compute proporcional
ao tempo ligada. A API da Render não expõe preço, fatura nem plano do workspace: a tabela de preços é nossa.

Total fixo (decisão do dono, 2026-11-12): 25 + 25 × N + 20 + 19 + 4,50 + 3,75 + 23 = **US$ 120,25 com 1 worker** e
**US$ 145,25 com 2**, mais excedentes de banda e build, R2 (0 hoje) e IA.

## Objetivo

Uma tela do super admin mostra o custo mensal da operação (mês corrente realizado + projeção até o fim do mês), o plano
e o preço de cada serviço, e o rateio: custo por sessão, por tenant e por plano (LITE/PRO/MAX), com a margem bruta de
infraestrutura contra o preço de vitrine. Preços ficam numa tabela editável pelo super admin; quantidades vêm do que o
sistema já mede (réplicas, sessões, tokens) e, onde não há medição, de valor manual rotulado como tal.

**Fora do caminho do usuário:** nenhuma rota chama a Render ou a Cloudflare; quem fala com a Render é um job do `worker`
sob lease, desligado por flag (mesmo padrão do coletor).

## Alternativas avaliadas

| Tema | Alternativa | Veredito | Por quê |
| --- | --- | --- | --- |
| Onde fica a tela | Aba nova em `/admin/workers` | ❌ | Custo cobre banco, Redis, R2, IA e e-mail, não só workers; a página já tem 5 abas e rolagem no celular |
| | **Página própria `/admin/costs` (seção Plataforma), com abas por sub-rota** | ✅ | Assunto próprio, cabe em 3–4 abas; o cartão da aba Capacidade ganha só um link "ver custos" |
| | Dentro da Assinatura/Planos | ❌ | São telas do tenant; custo é dado de plataforma |
| Fonte dos preços | API da Render | ❌ | Devolve o plano (`serviceDetails.plan`, `plan` do Postgres/Key Value), **não** o preço; não há API pública de fatura (não encontrei; conferir) |
| | **Tabela de preços em `platform_settings["infra_costs"]`, com valores iniciais e edição pelo super admin** | ✅ | Padrão da `worker_scaling` (refresh, 409 por `updatedAt`, auditoria); preço muda pouco e é público |
| | Preço fixo no código | ❌ | Mudança de preço ou de plano exigiria deploy |
| Fonte do plano e das réplicas | Digitação manual | 🟡 | Fica como **fallback** (P1 e itens fora da Render) |
| | Rota lê a Render ao vivo | ❌ | Viola "rota nunca chama a Render" (`ops-metricas.md`) |
| | **Job no `worker` (lease, flag) grava por hora plano + instâncias de cada recurso** | ✅ | Mesmo dono e chave do coletor; histórico durável para o custo proporcional ao tempo |
| Réplicas no tempo | `worker_scale_events` | ❌ | Só registra escaladas feitas pelo nosso escalador; mudança no painel da Render não aparece |
| | `ops_metrics_samples` (instâncias `srv-<id>-<sufixo>`) | 🟡 | Serve para "agora" na P1 (sem chamada externa); retenção de 7 dias não fecha o mês |
| | **Snapshot horário próprio (`infra_resource_hours`, 400 dias)** | ✅ | Fecha o mês e o histórico; ~5 recursos × 8.760 h/ano. Instâncias do worker na hora = `srv-<id>-<sufixo>` distintos nas amostras (sem chamada); Render como fallback |
| Tamanho de disco/storage | Só manual | 🟡 | Fallback quando o job está desligado |
| | **Job lê `disk.sizeGB` (`GET /services/{id}`) e `diskSizeGB` (`GET /postgres/{id}`) e avisa divergência com o cadastro (`config_drift`)** | ✅ | Mesma chamada horária; disco só cresce e ninguém lembra de atualizar à mão |
| Custo de trocar de plano | Simulador livre | ❌ | Infla o escopo |
| | **Coluna "plano vizinho" (um abaixo e um acima na tabela `renderPlanPrices`) por serviço, só leitura** | ✅ | Conta pura sobre a tabela que já existe; ex.: api 1c-2g 25 → 0.5c-512mb 7 (o `http` não segura sessões) |
| Rateio por sessão | **Sessões contratadas** (decisão do dono) | ✅ | "Custo por vaga vendida": previsível e fecha com o que o plano promete; tenant parado paga a vaga que reservou |
| | Sessão-hora conectada (uso real) | 🟡 | Segunda leitura: mostra quem consome socket/RAM |
| | Por tenant (divisão igual) | ❌ | Um MAX com 4 sessões custaria o mesmo que um LITE com 1 |
| Margem por plano | Preço do plano no banco | ❌ | Regra: preço é texto de marketing em `features/plans/catalog.ts`, nunca no banco |
| | **API devolve custo em USD e BRL; o painel compara o BRL com `PLAN_CATALOG` (mensal e anual-equivalente)** | ✅ | O preço continua só na vitrine; a conta é apresentação, como o chip "economize" |
| Moeda (decisão do dono) | — | — | Todo preço é cadastrado em **USD**; a tela mostra cada custo em **USD e BRL** (serviço, sessão, tenant, plano) |
| Cotação USD→BRL | Só manual na configuração, com data | 🟡 | Simples e sem chamada externa, mas envelhece se ninguém atualizar; fica como **override** (vale sobre todas) e é a única fonte da P1 |
| | API de terceiro sem contrato (AwesomeAPI etc.) | ❌ | Sem garantia de disponibilidade nem de termos de uso |
| | **PTAX de venda do BCB (Olinda `CotacaoDolarPeriodo`, oficial, sem chave, licença ODbL com atribuição), 1×/dia pelo job do `worker`; fallback SGS série 1 do BCB → última cotação salva; override manual do admin** | ✅ (decisão do dono, DD4) | Fonte oficial e gratuita, uso comercial permitido; rota sem chamada externa; janela de 7 dias cobre fim de semana e feriado |
| | AwesomeAPI / Frankfurter | ❌ | AwesomeAPI sem termos de uso comercial nem SLA; Frankfurter usa a referência do BCE e para em feriados europeus |
| | Busca na hora em cada requisição | ❌ | Chamada externa no caminho da tela, contra a regra das rotas de métricas |
| R2 | Somar objetos (`ListObjectsV2`) | ❌ | Chaves sem tenant (`media/<arquivo>`, `S3MediaFileStore.ts:75`), operação classe A paga, lento com muitos objetos |
| | API de analytics da Cloudflare | 🟡 | Possível depois (P4); exige token novo da Cloudflare |
| | **Item manual (0 hoje, editável), rateado como custo compartilhado** | ✅ | Hoje é grátis; sem tenant na chave não há rateio direto |
| IA da plataforma | Estimar por tenant | ❌ | Já existe medição |
| | **`ai_usage_logs` (`source = PLATFORM`, tokens por modelo) × preço por 1 M tokens na configuração** | ✅ | Custo direto por tenant e por plano; chave do próprio tenant não entra (custo dele) |
| E-mail | Contar envios | ❌ | Envio é da central; o CopySync não registra |
| | **Valor mensal manual (US$ 23)** | ✅ | Rateado como custo fixo |
| Banda (bandwidth) | Item manual | 🟡 | Fallback com o job desligado |
| | **`GET /v1/metrics/bandwidth` (vários `resource`, `startTime`/`endTime`, sem `resolution`) lido de hora em hora pelo job, 1 ponto por hora por serviço, gravado no nosso banco; total = soma de todos os serviços, inclusive o static `copysync_app`; incluso × consumido × excedente** | ✅ | Decisão do dono; a Render guarda só 7 dias no Hobby; o ponto sai ~60 min depois da janela (o job lê a hora fechada há mais de 1 h); unidade sempre do campo `unit`, nunca assumida; só egress para fora da Render é cobrado. Postgres/Key Value como `resource` não confirmados: ficam fora até a leitura real |
| Minutos de build | Item manual | 🟡 | Fallback e valor que vence quando preenchido |
| | **Estimar pelos deploys (`GET /v1/services/{id}/deploys`, `finishedAfter`/`finishedBefore`, cursor e `limit` ≤ 100, `finishedAt − startedAt`), 1×/dia no job, serviços Docker e static** | ✅ | A API não tem endpoint de uso de pipeline; superestima (inclui o update), rotulado "estimado"; o valor manual (copiado da página Billing) sobrepõe; imagem pré-construída provavelmente não conta |
| | Sem medição | ❌ | O dono quer o excedente na conta |

## Requisitos

| ID | Requisito |
| --- | --- |
| COST-01 | Configuração `InfraCostSettings` em `platform_settings` (chave `infra_costs`, JSON validado no domínio): `fx` = `{ auto: boolean, override: { rate (1–20, 4 casas), date } | null, closingMethod: 'last_business_day' | 'month_average' }` (override manual vale sobre todas as fontes até ser removido); lista `items[]` com `key` (slug estável, único), `label`, `category` (`compute`\|`database`\|`cache`\|`static`\|`storage`\|`ai`\|`email`\|`platform`\|`other`), `billing` (`fixed` = US$/mês × quantidade; `per_instance` = US$/mês por instância; `usage` = total do mês informado), `monthlyUsd` (componente de computação/plano, 0–100.000), `quantity` (manual, 0–100), `storage` = `null` (não se aplica) ou `{ gb (0–10.000) | null = tamanho a confirmar, usdPerGb }` com `usdPerGb` (0–10, **null = a confirmar**); `gb` ou `usdPerGb` nulos → o item soma só a computação e a resposta traz aviso `storage_to_confirm`, `renderKey` (`api`\|`worker`\|`redis`\|`postgres`\|`static`\|null; liga o item ao snapshot), `planLabel` (texto, ex.: "Standard 1 CPU/2 GB"), `allocation` (`shared`\|`excluded`), `note`; tabela `renderPlanPrices[]` (`resourceType` `service`\|`postgres`\|`key_value`, `plan` como a Render devolve, `monthlyUsd`); `aiModelPrices[]` (`kind`, `model`, `inputPerMTokUsd`, `outputPerMTokUsd`); `workspace` = `{ planLabel, cycleStartDay (1–28, padrão 1; ciclo da Render não confirmado), includedBandwidthGb, includedBuildMinutes, bandwidthUsdPerGb, buildUsdPer1000Min, manualBandwidthGb | null, manualBuildMinutes | null }` (manual vence a medição quando preenchido; incluso não acumula entre ciclos). Até 40 itens, 60 planos e 60 modelos. Campo desconhecido → 400 com o campo |
| COST-02 | Sem linha salva, valores iniciais do código com origem `default` (decisões do dono): api compute 25 + disco `{ gb: 15, usdPerGb: 0,25 }`; worker 25 por instância (`quantity` 1); static 0; redis 20; postgres 19 + `{ gb: 15, usdPerGb: 0,30 }`; e-mail `fixed` 23; R2 `usage` 0 (editável); `workspace` Hobby `{ 5 GB, 500 min, 0,15/GB, 5 por 1.000 min }`; `renderPlanPrices`: serviço 0.5c-512mb 7, 1c-2g 25, 2c-4g 85, 2c-8g 135; Postgres 0.1c-256mb 6, 0.5c-1g 19, 1c-2g 40, 1c-4g 55, 2c-4g 75; Key Value 1 GB 20; cotação `auto: true`, sem override, `closingMethod: last_business_day`. Valores rotulados "conferir no painel da Render" |
| COST-02a | Aba Resumo mostra, por serviço com `renderKey`, o custo do plano vizinho abaixo e acima em `renderPlanPrices` (diferença em USD e BRL), só leitura |
| COST-03 | `GET`/`PUT /admin/costs/settings` (super admin), `PUT` com `expectedUpdatedAt` (409), `updatedById` e auditoria `INFRA_COST_SETTINGS_CHANGED` com antes/depois. Sem segredo na configuração (sem id de recurso da Render) |
| COST-04 | P1 (sem job): `GET /admin/costs/summary?month=YYYY-MM` (super admin, só tabelas locais) devolve por item: quantidade efetiva e origem (`manual` \| `measured_now`), custo mensal em US$; total; custo fixo × variável; **custo marginal por sessão** = preço da instância do worker ÷ (`maxSessionsPerWorker` × `alertOccupancyRatio`) da configuração de escala. Instâncias do worker "agora" = instâncias distintas `worker_service` nas amostras da Render dos últimos 15 min (`ops_metrics_samples`), **só as atuais** (amostra mais nova a até 2 min da mais nova do serviço, mesma regra da tabela de instâncias; réplica trocada por deploy não soma), senão `quantity` manual. Leitura com `statement_timeout` estourado → 503 `INFRA_COST_READ_UNAVAILABLE` (sem SQL nem erro do banco; o painel oferece tentar de novo) |
| COST-05 | Rateio P1 (foto do momento). **Base padrão = sessões contratadas** de `IWorkerCapacityReader.readByPlan()` (`sessions/domain/contracts/IWorkerCapacityReader.ts`, só tenants `ACTIVE`): contratadas efetivas do plano = Σ por canal (WhatsApp, Telegram) de `contracted[canal]` + `unlimitedTenants[canal]` × limite do preset do plano no canal (`PLAN_PRESETS[plano][limitKeyOfChannel('sessions', canal)]`, `tenants/domain/planPresets.ts`/`channelLimits.ts`; grupo sem plano = 1 por tenant ilimitado), com aviso `unlimited_contracted` e a contagem. Custo por sessão = compartilhado ÷ Σ contratadas efetivas; parte do plano = contratadas do plano × custo por sessão; **tenant médio** = parte do plano ÷ `WorkerCapacityPlanRow.tenants` (total de tenants `ACTIVE` do plano, campo existente; 0 → `null`). **Segunda leitura (conectadas):** divisor = Σ `connected` por plano (`ACTIVE`); `sessions_connected` do cluster − essa soma = sessões **não alocadas** (tenant suspenso/cancelado), mostradas à parte com o custo que representam, sem rateio, **só com amostra recente**: a resposta traz `sessionsSampledAt`; amostra com mais de 10 min → aviso `sessions_sample_stale` e não alocadas `null` ("sem amostra recente"). Divisão por zero → `null` |
| COST-06 | Margem no painel: para cada plano, `preço de vitrine (R$) − custo por tenant em R$` para o mensal e o anual-equivalente de `PLAN_CATALOG`; rotulada "margem bruta de infraestrutura (sem gateway, impostos e IA da chave do tenant)". Sem cotação, a margem não aparece. A margem usa **sempre** o custo por tenant da base contratadas, qualquer que seja a leitura escolhida na tela. A API nunca recebe nem devolve preço de plano |
| COST-06a | Cotação: a API devolve `fx = { rate, referenceDate, source: 'override' | 'ptax' | 'sgs' | 'last_known', fetchedAt, stale }` e cada número em USD e BRL (USD × `rate`). Ordem: override manual → PTAX do dia → SGS → última salva → sem cotação (só USD, aviso `fx_missing`). P1: só override; o controle `fx.auto` aparece na aba Preços desabilitado, com o texto/selo "Próxima versão". P2 (`fx.auto`): o job, num único processo (lease `infra-fx-rate`, §3.3), roda 1×/dia depois das 16h30 UTC (boletim de fechamento ~13h BRT): PTAX de venda pela Olinda com janela de 7 dias (`$orderby=dataHoraCotacao desc&$top=1`; fim de semana/feriado devolve `value: []`, a janela resolve); falhou → SGS série 1 (`ultimos/1`); falhou → mantém a última e tenta **uma** vez 1 h depois; o estado da tentativa fica no banco (`platform_settings["infra_fx_fetch_state"]` = `{ referenceDay, attempts, lastAttemptAt }`), nunca em memória. Timeout 5 s, URLs fixas no código (sem SSRF), valor aceito só se número finito entre 1 e 20. Grava `infra_fx_rates` (`referenceDate`, `rate`, `source`, `fetchedAt`). `stale` = `referenceDate` com mais de 5 dias corridos; a tela mostra "cotação de DD/MM" e a atribuição "Fonte: Banco Central do Brasil (PTAX)" (ODbL). Fechamento: `closingMethod = last_business_day` usa a última cotação gravada com `referenceDate` no mês; `month_average` usa a média das gravadas no mês; os dois caem para a última salva antes do mês (aviso `fx_fallback`); override ativo vence. Mês fechado guarda `rate`, `referenceDate`, `source` e método (D7) |
| COST-06b | Arredondamento: cálculo em precisão cheia (USD com 6 casas internas, cotação com 4); a API devolve USD e BRL com 4 casas; o painel exibe 2 casas (`Intl.NumberFormat`, meio para cima) em totais, serviço, tenant e plano, e 4 casas quando o valor absoluto é menor que 0,01 (custo por sessão-hora). Percentual de margem com 1 casa. Somas sempre sobre os valores não arredondados |
| COST-07 | Aba **Resumo** em `/admin/costs`: cartões (total do mês, projeção — a partir da P2; na P1 o total já é o mês cheio com as quantidades de agora —, por sessão, marginal por sessão), tabela por plano com margem, tabela de serviços com plano, quantidade, origem e custo; bloco do workspace com banda e build: incluso, consumido, excedente e custo (P1: manual; P2: medido); selo "estimado" em todo número com entrada manual. cada valor em USD e em BRL lado a lado (BRL some só sem cotação), com a cotação, a data e a origem no topo |
| COST-08 | Aba **Preços** em `/admin/costs/prices`: edição da configuração com confirmação mostrando o diff, erro por campo, rascunho em `usePersistedState` (escopo `tab`) limpo ao salvar, 409 recarrega |
| COST-09 | P2: `InfraCostSnapshotJob` (papéis `worker`/`all`, lease `infra-cost-snapshot`, tick 5 min, grava uma vez por hora cheia UTC) lê instâncias do worker das amostras (`srv-<id>-<sufixo>` distintos na hora; Render como fallback) e da Render plano, instâncias dos demais e disco de cada recurso mapeado em `INFRA_COST_RENDER_RESOURCES` (env só no `worker`, `chave=id`) e grava `infra_resource_hours` (`hour`, `resourceKey`, `plan`, `instances`, `instancesSource`, `diskGb`, `suspended`). A cada hora grava a banda da hora fechada há mais de 1 h (todos os serviços mapeados, inclusive o static; unidade convertida pelo campo `unit`) e 1×/dia os minutos de build estimados pelos deploys do dia, em `infra_usage_daily` (`day`, `metric` `bandwidth_gb`\|`build_minutes`, `resourceKey`, `value`, `source`). 429 com backoff pelos headers `Ratelimit-*`/`Retry-After` (limite 400 GET/min; o job fica muito abaixo). Liga só com `INFRA_COST_SNAPSHOT_ENABLED=true` + `RENDER_API_KEY`; timeout 5 s; 429 respeita `Retry-After`; hora perdida não é inventada (fica "sem leitura"). Idempotente por `(hour, resourceKey)` |
| COST-10 | P2: o mesmo job grava `tenant_session_hours` (`day` UTC, `tenantId`, `planSlug` do momento, `connectedHours`, `contractedSessions` último valor, `lastHour`): soma 1 hora × sessões `CONNECTED` com lease vivo do tenant, só se `lastHour < hora atual` (sem dobra em troca de dono do lease). Retenção 400 dias nos dois, limpeza diária por lease de 24 h, em lotes |
| COST-11 | P2: custo do mês = Σ por hora (preço mensal do plano lido ÷ horas do mês × instâncias) para itens com `renderKey`; hora sem leitura usa a quantidade manual e marca "estimado". Plano lido sem preço na tabela: o item fica com custo `null`, o **total é parcial** (`totalIsPartial: true`, soma só o que tem preço) e sai o aviso `plan_without_price`; nunca 0 silencioso. Excedente do workspace = `max(0, consumido − incluso) × preço` para banda e build (manual vence a medição). Projeção = realizado + (última hora lida × horas restantes) + excedente projetado pela média diária |
| COST-12 | P2: rateio do mês com a base padrão **contratadas** (média diária de `contractedSessions` de `tenant_session_hours`, mesma regra de ilimitado da COST-05) e segunda leitura por **sessão-hora** (compartilhado ÷ Σ `connectedHours`; × 730 = sessão-mês). Por plano e por tenant nas duas bases. Capacidade ociosa = custo − parte usada (só na leitura por sessão-hora, mostrada, não rateada) |
| COST-13 | P3: custo de IA da plataforma por tenant e por plano = `ai_usage_logs` (`source = PLATFORM`, `success`, mês) × `aiModelPrices` (modelo sem preço → aviso `model_without_price`, não 0). `inputTokens`/`outputTokens` são `Int?`: linhas com token nulo são contadas e geram aviso `ai_tokens_missing` com a quantidade (custo delas fora do total, nunca 0 silencioso). Somado ao rateio como custo **direto** |
| COST-14 | P3: aba **Por cliente** em `/admin/costs/tenants`: lista paginada no servidor (cursor opaco) com nome, plano, sessões contratadas, sessão-hora, custo compartilhado, IA, total e margem (no painel). Mês corrente: ordem estável no SQL por `contractedSessions desc, tenantId` (base padrão do rateio), custo calculado só na página. Mês fechado: ordem por custo total congelado (`infra_cost_month_tenants`), mais `tenantId`. Nome com `Blurred` (flag `costs.tenantName`); filtro por plano persistido |
| COST-15 | P3: fechamento mensal `infra_cost_months` (mês, totais por item, por plano e cotação usada) gravado pelo job na 1ª hora do mês seguinte (idempotente); mês fechado usa os preços daquele momento (edição posterior não reescreve). Mês corrente usa a configuração atual. Aba **Histórico** em `/admin/costs/history`: 12 meses, total e por plano |
| COST-16 | Filtros (mês, base contratadas × sessão-hora, plano) em `usePersistedState('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' })` (base padrão: contratadas). Textos em `features/infraCosts/strings.ts`, sem marca; modos sistema/claro/escuro pelo tema |
| COST-17 | Documentação: `docs/custos-infraestrutura.md` novo; linha em "Marca e domínios" do `AGENTS.md`; linha em "Ferramentas operacionais" do `docs/produto-roadmap.md`; `docs/ops-metricas.md` (job novo, envs, recorte da regra); `docs/arquitetura-escala.md` §3.3 (dono por job) e §5.1 (envs); `docs/planos.md` (margem lê o catálogo, preço segue fora do banco) |

## Fora do escopo

| Item | Motivo |
| --- | --- |
| Fatura real da Render/Cloudflare (conciliação) | Sem API pública de fatura; valor da tela é estimativa rotulada |
| Taxa do gateway (Cakto), impostos, receita real | Billing é da central (`arquitetura-central-billing.md`); a tela não sabe se o tenant paga mensal ou anual |
| Custo do PulsoSocial/central | Outro produto e outra infraestrutura |
| R2 por tenant | Chave do objeto não tem tenant; mudar o layout das chaves é outra feature |
| Decidir escala pelo custo | O escalador já tem teto de réplicas (`maxReplicas`) |

## Critérios de aceite (smoke, depois da última tarefa de cada fase)

1. **P1:** em ambiente local com Postgres descartável, sem linha salva, a aba Resumo mostra os serviços com os valores iniciais, total fixo US$ 120,25 (1 worker; 145,25 com amostras de 2 instâncias), custo por sessão contratada com o leitor de capacidade, bloco do workspace com os valores manuais, e a margem mensal e anual por plano depois de salvar um override de cotação. Nenhuma chamada externa.
2. **P2:** com amostras sintéticas de 1 → 2 instâncias do worker no meio do mês, o custo do worker é proporcional às horas; com as amostras **zeradas** numa faixa de horas, o `fetchFn` falso da Render responde as instâncias (fallback exercitado); `tenant_session_hours` não dobra com dois processos disputando o lease; banda acima de 5 GB gera excedente.
3. **P3:** tenants com nomes borrados pela flag; IA de um tenant com 1 M tokens de entrada aparece como custo direto; o mês anterior fechado não muda ao editar um preço.

## Decisões

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1 | Página própria `/admin/costs`, item "Custos" na seção Plataforma | Aba em Workers | Escopo maior que workers |
| D2 | Preços em `platform_settings["infra_costs"]`; plano e instâncias medidos pelo job | Tudo manual / tudo da Render | A Render não dá preço; quantidade medida evita erro de digitação |
| D3 | Ids da Render só na env do `worker` (`INFRA_COST_RENDER_RESOURCES`); a configuração usa chaves lógicas | Id no banco/tela | Regra do escalador: id de serviço nunca em resposta, log ou evento |
| D4 | Rateio padrão por sessões contratadas; sessão-hora conectada como segunda leitura (decisão do dono) | Sessão-hora como padrão | Custo por vaga vendida, previsível; uso real fica visível na segunda leitura |
| D5 | Margem calculada no painel com `PLAN_CATALOG` | Preço no banco | Regra de `docs/planos.md` |
| D6 | Preços em USD; API devolve USD e BRL; cotação PTAX automática com fallback (P2), manual na P1 | Só manual / guardar R$ | Decisão do dono (USD e BRL em todo número); PTAX é oficial e sem chave |
| D7 | Mês fechado congela preços e a cotação usada (valor, data, origem) | Recalcular sempre | Histórico não muda por edição de preço |
| D8 | Fase P1 sem tabela nova nem chamada externa | Começar pelo job | Tela útil já com os números de hoje |
| D10 | Componentes de armazenamento (disco da api 15 GB × 0,25, storage do Postgres 15 GB × 0,30) como campos do item; tamanho lido pelo job vence o cadastrado | Item separado por componente | Um item por serviço; tamanho nulo gera aviso `storage_to_confirm` em vez de custo inventado |
| D9 | Linha nova "Custos da infraestrutura" em "Ferramentas operacionais" do roadmap | Sem item | Regra: feature nova cabe em item do roadmap |

## Decisões do dono (2026-11-12)

| # | Decisão |
| --- | --- |
| DD1 | Disco da `copysync_api`: 15 GB (US$ 3,75/mês), mantido (o chat pode usar) |
| DD2 | E-mail pela central: US$ 23/mês, custo do CopySync |
| DD3 | R2: grátis hoje; item manual com 0, editável |
| DD4 | Cotação: PTAX Olinda → SGS série 1 → última salva; override manual vale sobre todas até ser removido. Fechamento configurável: último dia útil (padrão) ou média do mês, ambos com fallback para a última salva |
| DD5 | Margem contra o mensal **e** o anual-equivalente |
| DD6 | Rateio padrão por sessões contratadas; sessão-hora conectada como segunda leitura |
| DD7 | Banda e build entram na conta (incluso, consumido, excedente): banda pela métrica da Render no job; build estimado pelos deploys, com valor manual que vence |
| DD8 | Totais fixos: US$ 120,25 com 1 worker, 145,25 com 2, mais excedentes |

Pendente de conferência (não é pergunta): formato real das respostas da Render (plano, disco, banda, deploys) numa leitura antes de ligar o job.

## Desvios aceitos na P1 (2026-11-12)

| Tarefa | Desvio | Onde ficou |
| --- | --- | --- |
| T1 | Unicidade também de `renderKey`, `(resourceType, plan)` e `(kind, model)`; limites de lista próprios | COST-01 (código); `Key Value` plano `1gb` a conferir na T12 |
| T2 | `resolveFxRate({ fx, today })`; entrada opcional `resources[]` (P2); fixo = `fixed` + armazenamento, variável = `per_instance` + `usage` + excedente; não alocadas × custo por sessão conectada; workspace sem manual = consumido `null`, custo 0; "estimado" = quantidade manual | COST-04/05 |
| T5 | COST-04 conta só instâncias atuais (≤ 2 min da mais nova) dentro dos 15 min | COST-04 |
| T6/R1 | `statement_timeout` → 503 `INFRA_COST_READ_UNAVAILABLE`; `sessionsSampledAt` e `sessions_sample_stale` (não alocadas só com amostra ≤ 10 min) | COST-04, COST-05 |
| T8 | Margem sempre pela base contratadas | COST-06 |
| T9 | Cotação automática da P1 mostrada desabilitada com "Próxima versão" | COST-06a |
