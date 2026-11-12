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
- **Workspace** (Hobby): incluso × consumido × excedente para banda e build; na P1 o consumido é o valor manual.
- **Plano vizinho**: por serviço com `renderKey`, custo um plano abaixo e um acima em `renderPlanPrices` (só leitura).
- **Custo marginal por sessão** = preço da instância do worker ÷ (`maxSessionsPerWorker` × `alertOccupancyRatio`),
  lidos de `workerScalingSettingsProvider().current()` a cada chamada.
- Item sem preço fica `null` e o total vira parcial (`totalIsPartial: true`); nunca 0 silencioso. Divisão por zero → `null`.

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
- Sem cotação, a margem não aparece. A API nunca recebe nem devolve preço de plano.

## Cotação USD→BRL

- A API devolve cada número em USD e BRL (`usd × rate`, 4 casas; o painel mostra 2, e 4 abaixo de 0,01).
- **P1: só override manual** (`fx.override` = valor 1–20 com 4 casas e data). Sem override → só USD e aviso `fx_missing`.
- A cotação automática (`fx.auto`) **não tem Switch** na P1: a aba Preços mostra só uma linha de status com o chip
  "Em breve". O `fx.auto` salvo fica como está (liga sozinho na P2).

## Previsto

- **P2**: `InfraCostSnapshotJob` no `worker` (lease, flag `INFRA_COST_SNAPSHOT_ENABLED`, ids em
  `INFRA_COST_RENDER_RESOURCES`): plano, instâncias e disco por hora, banda e build medidos, PTAX do BCB 1×/dia (SGS e
  última salva como fallback), custo proporcional ao tempo, projeção, sessão-hora, seletor de mês.
- **P3**: custo de IA da plataforma por tenant (`ai_usage_logs`), fechamento mensal congelado, abas Por cliente
  (nome com `Blurred`) e Histórico.

## O que NÃO fazer

- Preço de plano **nunca** no banco nem na API: margem só no painel, lendo `PLAN_CATALOG` (`docs/planos.md`).
- **Nenhuma rota chama a Render** (nem a Cloudflare nem o BCB): o resumo lê só tabelas locais. Quem fala com a Render
  é o job do `worker` (P2).
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
- Outro mês na P1 → 400 `INFRA_COST_MONTH_UNAVAILABLE`; não inventar mês sem dado.
- Não ler `WORKER_MAX_*` nem guardar o teto: provider a cada chamada.
- Textos só em `features/infraCosts/strings.ts`; rascunho da aba Preços em `usePersistedState` (escopo `tab`), limpo ao salvar.
