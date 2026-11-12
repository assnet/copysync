# Custos da infraestrutura

Ferramenta operacional do super admin (`docs/produto-roadmap.md`, "Ferramentas operacionais"). Mostra quanto custa a
operação por mês, por serviço, por sessão e por plano, com a margem bruta de infraestrutura contra o preço de vitrine.
Plano completo (P1–P3): `.specs/features/infra-costs/{spec,design,tasks}.md`. Este doc registra o que **está** no código.

## O que existe (P1 — api 0.88.0 · app 0.108.0)

| Peça | Onde | Nota |
| --- | --- | --- |
| Configuração | `platform_settings["infra_costs"]`, domínio em `api/src/modules/metrics/domain/services/infraCostSettings.ts` | Sem linha = valores iniciais do código (origem `default`). Preços em **USD**. Até 40 itens, 60 planos, 60 modelos; campo desconhecido → 400 com `field` |
| Repositório | `metrics/infrastructure/repositories/PrismaInfraCostSettingsRepository.ts` | 409 por `expectedUpdatedAt`; linha inválida → default com `updatedAt` real |
| Leitor do momento | `PrismaInfraCostLiveReader.ts` | Última `sessions_connected`/`sessions_capacity` (1 h) e instâncias do worker (15 min) em `ops_metrics_samples`; `statement_timeout` 2 s |
| Cálculo | `domain/services/infraCostCalculator.ts`, `fxRate.ts` | Funções puras; `basis: 'snapshot'` (foto do momento × mês cheio) |
| Rotas | `presentation/routes/infraCosts.routes.ts` (`/api/admin/costs`) | `GET`/`PUT /settings`, `GET /summary?month=YYYY-MM`; só super admin |
| Auditoria | `AuditAction.INFRA_COST_SETTINGS_CHANGED` | Antes/depois a cada `PUT` |
| Painel | `/admin/costs` (Resumo) e `/admin/costs/prices` (Preços), `app/src/features/infraCosts/`, `pages/admin/AdminCostsPage.tsx` | Item "Custos" na seção Plataforma; link "Ver custos" no cartão da aba Capacidade dos workers |

## O que existe (P2 — api 0.89.0 · app 0.109.0)

| Peça | Onde | Nota |
| --- | --- | --- |
| Tabelas | migration `create_infra_cost_snapshots`: `infra_resource_hours`, `tenant_session_hours`, `infra_fx_rates`, `infra_usage_daily` | Retenção 400 dias (limpeza diária em lotes de 5 mil, `statement_timeout` 2 s) |
| Repositórios | `PrismaInfraCostSnapshotRepository.ts`, `PrismaInfraTenantUsageReader.ts`, `PrismaInfraCostUsageReader.ts`, `PrismaInfraFxFetchStateRepository.ts` | `upsert` por `(hour, resourceKey)`; sessão-hora e banda com guarda `lastHour` |
| Job | `metrics/infrastructure/jobs/InfraCostSnapshotJob.ts` (`infraCostSnapshot` em `app/processJobs.ts`) | Só `worker`/`all`, só com `INFRA_COST_SNAPSHOT_ENABLED=true` |
| Render | `sources/RenderInfraResourcePlanReader.ts` (sem config: `NotConfiguredInfraResourcePlanReader`), env em `shared/config/infraCostRenderResources.ts` | Plano, instâncias, disco, banda por hora, deploys do dia; timeout 5 s; 429 respeita `Retry-After` |
| Cotação | `sources/BcbPtaxFxRateSource.ts`, `BcbSgsFxRateSource.ts`, `domain/services/fxRate.ts`, `infraFxFetchState.ts` | URLs fixas, valor aceito só finito entre 1 e 20 |
| Cálculo | `infraCostCalculator.ts` com `basis: 'hours'` | Soma por hora, projeção, sessão-hora, ociosidade |
| Painel | `SummaryTab.tsx`, `useCostSummary.ts` | Seletor de mês (corrente + 11 anteriores pelo relógio do servidor), base contratadas × sessão-hora, avisos com atalho para Preços |

## Job horário (`InfraCostSnapshotJob`)

Tick de 5 min (`unref`) sob o lease `infra-cost-snapshot` (TTL 4 min, solto no `stop`), **renovado antes de cada
passo** e antes de gravar a hora: renovação falhou (outro processo assumiu) = o passo não roda. Cada tick, nesta ordem,
cada passo isolado (falha de um não para os outros, `warn` com o nome do passo):

1. **Hora fechada** `H` (hora cheia UTC anterior), só se `infra_resource_hours` ainda não tem `H`: lê os tenants
   (sessão-hora = 1 h × sessões `CONNECTED` com lease vivo; contratadas), a Render (plano, instâncias, disco de cada
   recurso) e as instâncias do worker pelas amostras (`srv-<id>-<sufixo>` distintos da hora, média por minuto,
   arredondada; Render como fallback). Grava sessão-hora → recursos; recursos por último, como marca de "hora
   feita". **Tudo ou nada nos recursos**: um recurso sem leitura ou sem `numInstances` (instâncias desconhecidas, sem
   amostra do worker para cobrir) → hora sem linha, um `warn` por sequência de falha
   (`infra cost hour without render reading`), tenta de novo no próximo tick. **A sessão-hora é gravada antes de
   olhar a Render** (desvio aceito: não depende dela e é idempotente por `lastHour`), então sai mesmo com a Render fora,
   em pausa por 429 ou sem configuração. Troca de dono do lease não dobra.
2. **Banda** das horas fechadas há mais de 1 h ainda sem linha, até 6 h para trás (`INFRA_COST_BANDWIDTH_CATCHUP_HOURS`),
   em ordem, de todos os serviços mapeados (inclusive o static), convertida pelo campo `unit` (série sem `unit`
   descartada), em `infra_usage_daily` (`bandwidth_gb`, coluna `hours` +1 por hora somada). Para na 1ª falha: a guarda
   `lastHour` não aceita hora anterior a uma já somada, então a hora volta no tick seguinte enquanto estiver na janela.
   Hora sem banda além de 6 h fica sem linha e o resumo avisa `bandwidth_missing_hours`.
3. **Build**: minutos do dia anterior (`finishedAt − startedAt` dos deploys, com cursor), 1×/dia a partir de 01:00 UTC
   (lease `infra-cost-build` até 01:00 do dia seguinte; falha = nova tentativa 1 h depois), em `infra_usage_daily`
   (`build_minutes`). Teto de 20 páginas por serviço e dia: esgotou com `cursor` ainda presente = falha (`upstream`),
   nunca minutos parciais.
4. **Cotação** (com `fx.auto`), ver abaixo.
5. **Retenção** de 400 dias, 1×/24 h (lease `infra-cost-retention`, não solto).

**429 da Render** (qualquer leitura): a pausa vai para o lease `infra-cost-render-backoff` com vencimento =
`Retry-After` (senão `Ratelimit-Reset`; sem nenhum, 60 s; teto 1 h). Enquanto vale, recursos, banda e build não chamam
a Render (a hora fica sem linha e volta depois). Nada em memória: vale para qualquer processo que assuma o job.

Memória só para não repetir `warn`; todo estado que importa está no banco.

## A conta

- **Item** (`items[]`): `billing` `fixed` (US$/mês × quantidade), `per_instance` (US$/mês por instância) ou `usage`
  (total do mês informado). `storage` = `null` (não se aplica) ou `{ gb, usdPerGb }`; qualquer um nulo → só a
  computação entra e sai o aviso `storage_to_confirm`.
- **Valores iniciais** (decisões do dono, 2026-11-12): api 25 + disco 15 GB × 0,25; worker 25 por instância; static 0;
  Redis 20; Postgres 19 + 15 GB × 0,30; e-mail 23; R2 0 (editável). Total **US$ 120,25 com 1 worker, 145,25 com 2**,
  mais excedentes do workspace.
- **Instâncias do worker agora**: instâncias distintas do serviço worker (`worker_service`) nas amostras da Render dos
  últimos 15 min, **só as atuais** (amostra a até 2 min da mais nova do serviço, mesma regra da tabela de instâncias:
  réplica trocada por deploy não soma). Sem amostra → `quantity` manual (origem `manual`).
- **Workspace** (Hobby): incluso × consumido × excedente para banda e build. Consumido = valor manual quando
  informado (vence), senão o **medido** pelo job no mês (`infra_usage_daily`); na foto (sem snapshot) só o manual.
- **Plano vizinho**: por serviço com `renderKey`, custo um plano abaixo e um acima em `renderPlanPrices` (só leitura).
- **Custo marginal por sessão** = preço da instância do worker ÷ (`maxSessionsPerWorker` × `alertOccupancyRatio`),
  lidos de `workerScalingSettingsProvider().current()` a cada chamada.
- Item sem preço fica `null` e o total vira parcial (`totalIsPartial: true`); nunca 0 silencioso. Divisão por zero → `null`.

### Modo horas (P2)

- `basis: 'hours'` quando o mês tem snapshot; `basis: 'snapshot'` (foto × mês cheio) só no mês corrente sem snapshot.
- **Item com `renderKey`**: Σ por hora (preço mensal do plano lido ÷ horas do mês × instâncias). Ex.: 1 → 2 instâncias
  no dia 15 de um mês de 30 dias = 25 + 12,50. Hora sem leitura usa a quantidade manual e gera `missing_hours` com a
  contagem. Plano lido sem preço em `renderPlanPrices` → item `null`, `totalIsPartial` e `plan_without_price`.
  Cadastro diferente do lido (plano, instâncias, disco) → `config_drift` (gerado no calculador).
- **Item sem `renderKey`**: proporcional às horas decorridas do mês.
- **Ciclo = mês calendário UTC** (`cycleStartDay` não é usado).
- **Realizado** = soma até agora. **Projeção** (`totals.projected`) = realizado + última hora lida × horas restantes +
  excedente do workspace projetado pela média diária.
- **Sessão-hora** (2ª leitura): compartilhado ÷ Σ `connectedHours`; `perSession.connected` = média do mês,
  `perSessionHour` e `sessionHours` na resposta, sessão-mês = sessão-hora × 730. **Capacidade ociosa**
  (`idleCapacity`, mostrada e não rateada) = compartilhado × janela × (1 − sessão-hora da janela ÷ capacidade-hora),
  só nas horas com leitura do worker (janela = horas lidas ÷ decorridas; capacidade = instâncias × teto por hora lida).
  A sessão-hora é gravada por dia, então entra proporcional à janela. **Estimativa conservadora**: o numerador conta
  só tenants `ACTIVE` (sessão de tenant fora disso conta como ociosa) e horas sem leitura do worker ficam de fora,
  com o aviso `idle_partial` (contagem).
- **Banda medida**: `bandwidth_missing_hours` (contagem) quando o mês tem menos horas com banda que o esperado
  (todas as horas no mês passado; até 2 h atrás no corrente, pela defasagem da banda + tick). Sem aviso com banda
  manual. Consumido e excedente saem com 4 casas, como o dinheiro.
- **Contratadas** no modo horas = média diária de `contractedSessions` de `tenant_session_hours`, mesma regra de
  ilimitado.
- **Mês passado**: só por horas, sem a foto de agora (não alocadas `null`, sem capacidade por plano), cotação gravada
  até o último dia do mês (override vale sempre). Mês passado sem dado ou mês futuro → 400
  `INFRA_COST_MONTH_UNAVAILABLE` (painel mostra "vazio" com o seletor).

## Rateio

- **Base padrão = sessões contratadas** (custo por vaga vendida): `IWorkerCapacityReader.readByPlan()`, só tenants
  `ACTIVE`. Contratadas efetivas = Σ por canal de `contracted` + tenants ilimitados × limite do preset do plano no
  canal (aviso `unlimited_contracted`). Custo por sessão = compartilhado ÷ Σ contratadas; parte do plano = contratadas
  do plano × custo por sessão; tenant médio = parte ÷ `tenants` do plano.
- **Segunda leitura = conectadas** (Σ `connected` dos `ACTIVE`). **Não alocadas** = `sessions_connected` do cluster −
  essa soma (tenant suspenso/cancelado), mostradas à parte, fora do rateio, e **só com amostra recente**: amostra com
  mais de 10 min → aviso `sessions_sample_stale` e não alocadas `null` ("sem amostra recente"). A resposta traz
  `sessionsSampledAt`.

## Margem

- Calculada **só no painel** (`features/infraCosts/rules.ts`, `planMargin`): preço de vitrine de `PLAN_CATALOG`
  (mensal e anual-equivalente) − custo por tenant em R$. Sempre pela base **contratadas**, qualquer que seja a leitura
  escolhida na tela. Rótulo: margem bruta de infraestrutura (sem gateway, impostos e IA da chave do tenant).
- **Mês corrente por horas = margem projetada**: usa `plans[].projectedCostPerTenant` (contratadas médias ×
  compartilhado projetado ÷ Σ contratadas), marcada "projetada" na tela. **Mês passado** = realizado
  (`costPerTenant`). Foto (sem snapshot) = `costPerTenant`, que já é o mês cheio.
- Sem cotação, a margem não aparece. A API nunca recebe nem devolve preço de plano.

## Cotação USD→BRL

- A API devolve cada número em USD e BRL (`usd × rate`, 4 casas; o painel mostra 2, e 4 abaixo de 0,01).
- Ordem: **override manual** (`fx.override` = valor 1–20 com 4 casas e data) → cotação gravada em `infra_fx_rates`
  → `null` (só USD e aviso `fx_missing`). Se a busca de hoje falhou, a gravada sai com `source: 'last_known'`. `stale`
  = `referenceDate` com mais de 5 dias corridos. Atribuição na tela: "Fonte: Banco Central do Brasil (PTAX)".
- **Busca automática (P2, `fx.auto`, padrão `true`)**, feita só pelo job: 1×/dia após 16h30 UTC, sob o lease
  `infra-fx-rate`: **PTAX** de venda (Olinda `CotacaoDolarPeriodo`, janela de 7 dias) → **SGS** série 1
  (`ultimos/1`) → mantém a **última** gravada e faz **no máximo 1 nova tentativa 1 h depois**. Estado da tentativa em
  `platform_settings["infra_fx_fetch_state"]` (`ok`, `referenceDay`, `attempts`, `lastAttemptAt`): sobrevive a
  reinício, nunca em memória. Timeout 5 s, URLs fixas no código.
- A aba Preços tem o Switch "Buscar a cotação no Banco Central" (`fx.auto`), com a dica do horário (13h30 de
  Brasília) e da ordem PTAX → SGS → última. Desligado, o job não busca e vale a última gravada. A cotação manual vale
  sobre a automática com o Switch ligado ou desligado.

## Previsto

- **P3**: custo de IA da plataforma por tenant (`ai_usage_logs`), fechamento mensal congelado, abas Por cliente
  (nome com `Blurred`) e Histórico.

## Envs (só na Render, só no `worker`)

| Env | Padrão | Uso |
| --- | --- | --- |
| `INFRA_COST_SNAPSHOT_ENABLED` | `false` | Liga o job. Desligada: nada é montado nem chamado |
| `INFRA_COST_RENDER_RESOURCES` | vazio | `chave=id` por vírgula: `api=srv-<id>,worker=srv-<id>,static=srv-<id>,postgres=dpg-<id>,redis=red-<id>`. Chaves só essas cinco; prefixo exigido por chave (`srv-`/`dpg-`/`red-`). Entrada malformada, chave desconhecida, id inválido ou chave repetida é ignorada com `warn` sem o id. Sem `worker=` usa `WORKER_SCALER_SERVICE_ID` válido |
| `RENDER_API_KEY` | vazio | Já usada pelo coletor (`docs/ops-metricas.md`). Sem ela ou sem ids, as horas ficam sem leitura da Render. **Intencional**: o job liga só com a flag e, sem a chave, grava a sessão-hora e a cotação (as duas não dependem da Render) |

### Como ligar com segurança

1. Deploy da versão com as migrations `create_infra_cost_snapshots` e `add_infra_usage_daily_hours` (aplicadas no boot, §5.1 de
   `docs/arquitetura-escala.md`).
2. Só no serviço `worker` (nunca no `http`): `INFRA_COST_RENDER_RESOURCES` com os ids reais (copiados do painel da
   Render; nunca em doc, chat, log ou git) e depois `INFRA_COST_SNAPSHOT_ENABLED=true`.
3. Conferir os logs do boot: `Infra cost snapshot job started` com `render: true`; nenhum
   `infra cost render resource entry ignored` (se sair, o `issue`/`key` diz qual entrada corrigir).
4. Nas primeiras horas: uma linha por recurso e hora cheia em `infra_resource_hours`, `tenant_session_hours` do dia
   crescendo 1 h por hora, nenhum `infra cost hour without render reading` repetido; banda a partir da 2ª hora, build
   no dia seguinte após 01:00 UTC, cotação após 16h30 UTC. Em `/admin/costs`, o mês corrente passa a `basis: 'hours'`
   sem `config_drift` inesperado.
5. **Reverter**: `INFRA_COST_SNAPSHOT_ENABLED=false`. As tabelas ficam; o resumo volta à foto quando o mês não tem
   snapshot (apagar linhas só com autorização).

## O que NÃO fazer

- Preço de plano **nunca** no banco nem na API: margem só no painel, lendo `PLAN_CATALOG` (`docs/planos.md`).
- **Nenhuma rota chama a Render** (nem a Cloudflare nem o BCB): o resumo lê só tabelas locais. Quem fala com a Render
  e com o BCB é só o job do `worker`.
- Não ligar o job no `http` nem gravar hora inventada: hora sem leitura fica sem linha (custo pela quantidade manual).
- Não guardar estado da cotação, da hora gravada ou da banda em memória: o banco (lease + `lastHour` + linha da hora)
  é o que impede dobra na troca de dono.
- Id de recurso da Render **só em env** do `worker`; nunca na configuração, resposta, log, teste ou doc (use `srv-teste`).
- Leitura lenta (`statement_timeout`) → **503 `INFRA_COST_READ_UNAVAILABLE`**, sem SQL, id ou erro do banco no corpo
  ou no log. O painel tem estado próprio para esse código ("A leitura demorou mais que o normal. Tente de novo." e
  botão "Tentar de novo"), distinto do "Estamos atualizando o sistema" do deploy, e **sem auto-retry**. Não trocar por
  500 nem por valor parcial.
- `key` de serviço **só de dígitos** (ex.: `"2"`) é proibida na API (400 com `field` `items[n].key`) e no painel
  (`validateSettingsDraft`): o caminho `items[2]` seria lido como índice da linha.
- `sessionsSampledAt` é o horário da `sessions_connected` usada nas não alocadas, nunca o da `sessions_capacity`.
- Cor de tom (sucesso/aviso/erro) só via `toneColor`/`toneChipSx` de `components/costParts.tsx` (≥ 4,5:1 nos dois
  temas, testado); `srOnly` com `'1px'` em string (número 1 no `sx` vira 100%).
- Mês sem dado (passado) ou futuro → 400 `INFRA_COST_MONTH_UNAVAILABLE`; não inventar mês nem usar a foto de agora
  para mês passado.
- Não ler `WORKER_MAX_*` nem guardar o teto: provider a cada chamada.
- Textos só em `features/infraCosts/strings.ts`; rascunho da aba Preços em `usePersistedState` (escopo `tab`), limpo ao salvar.
