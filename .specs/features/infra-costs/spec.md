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
| `copysync_api` | Web Service, Docker, `PROCESS_ROLE=http` | 1 CPU/2 GB | 25 | **disco** (por GB; tamanho e preço por GB a confirmar). Com disco a Render não escala o serviço |
| `copysync_worker` | Private Service, Docker, `PROCESS_ROLE=worker` | 1 CPU/2 GB, **por instância** | 25 × N | — (hoje 2 instâncias por causa do teste T25; normalmente 1). Autoescala nativa exige workspace Pro: não usada |
| `copysync_app` | Static Site | — | 0 | — |
| `copysync-redis` | Key Value (Valkey 8) | 1 GB / 1.000 conexões | 20 | — |
| `db-copysync-postgres` | PostgreSQL 18, sem HA | 0.5 CPU/1 GB | 19 | **armazenamento 15 GB** (por GB; preço por GB a confirmar), sem autoescala de storage |
| Workspace Render | Hobby (gratuito, botão "Upgrade") | — | 0 | taxa por membro só se mudar de plano |
| Cloudflare R2 | mídia (`MEDIA_STORAGE_DRIVER=s3`) | por GB e por operação | variável | — |
| IA da plataforma | provedores do super admin | por token | variável | — |
| E-mail | central (PulsoSocial), SMTP do domínio | — | ? | — |

Total fixo conhecido hoje: US$ 25 + 25 × N + 20 + 19 = **US$ 89 com 1 worker** (114 com 2), mais disco da api,
storage do Postgres, R2, IA e e-mail.

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
| | **Snapshot horário próprio (`infra_resource_hours`, 400 dias)** | ✅ | Fecha o mês e o histórico; ~5 recursos × 8.760 h/ano |
| Rateio por sessão | Sessões contratadas | 🟡 | Mostra "custo por vaga vendida"; exibido como segunda leitura |
| | **Sessão-hora conectada (uso real)** | ✅ | Reflete quem consome socket/RAM; tenant parado não paga pela vaga de quem usa |
| | Por tenant (divisão igual) | ❌ | Um MAX com 4 sessões custaria o mesmo que um LITE com 1 |
| Margem por plano | Preço do plano no banco | ❌ | Regra: preço é texto de marketing em `features/plans/catalog.ts`, nunca no banco |
| | **API devolve custo em USD e BRL; o painel compara o BRL com `PLAN_CATALOG` (mensal e anual-equivalente)** | ✅ | O preço continua só na vitrine; a conta é apresentação, como o chip "economize" |
| Moeda (decisão do dono) | — | — | Todo preço é cadastrado em **USD**; a tela mostra cada custo em **USD e BRL** (serviço, sessão, tenant, plano) |
| Cotação USD→BRL | Só manual na configuração, com data | 🟡 | Simples e sem chamada externa, mas envelhece se ninguém atualizar; fica como **fallback** e como valor da P1 |
| | API de terceiro sem contrato (AwesomeAPI etc.) | ❌ | Sem garantia de disponibilidade nem de termos de uso |
| | **PTAX de venda do BCB (Olinda `CotacaoDolarPeriodo`, oficial, sem chave, licença ODbL com atribuição), 1×/dia pelo job do `worker`; fallback SGS série 1 do BCB → última cotação salva; override manual do admin** | ✅ recomendada | Fonte oficial e gratuita, uso comercial permitido; rota sem chamada externa; janela de 7 dias cobre fim de semana e feriado. **Decisão do dono: PTAX automática + override manual (recomendado) × só manual** |
| | AwesomeAPI / Frankfurter | ❌ | AwesomeAPI sem termos de uso comercial nem SLA; Frankfurter usa a referência do BCE e para em feriados europeus |
| | Busca na hora em cada requisição | ❌ | Chamada externa no caminho da tela, contra a regra das rotas de métricas |
| R2 | Somar objetos (`ListObjectsV2`) | ❌ | Chaves sem tenant (`media/<arquivo>`, `S3MediaFileStore.ts:75`), operação classe A paga, lento com muitos objetos |
| | API de analytics da Cloudflare | 🟡 | Possível depois (P4); exige token novo da Cloudflare |
| | **Valor mensal manual (GB e operações do painel da Cloudflare), rateado por sessão-hora** | ✅ | Hoje é pequeno; sem tenant na chave não há rateio direto |
| IA da plataforma | Estimar por tenant | ❌ | Já existe medição |
| | **`ai_usage_logs` (`source = PLATFORM`, tokens por modelo) × preço por 1 M tokens na configuração** | ✅ | Custo direto por tenant e por plano; chave do próprio tenant não entra (custo dele) |
| E-mail | Contar envios | ❌ | Envio é da central; o CopySync não registra |
| | **Valor mensal manual** | ✅ | Rateado como custo fixo |

## Requisitos

| ID | Requisito |
| --- | --- |
| COST-01 | Configuração `InfraCostSettings` em `platform_settings` (chave `infra_costs`, JSON validado no domínio): `fx` = `{ auto: boolean, override: { rate (1–20, 4 casas), date } | null }` (override manual vale até ser removido); lista `items[]` com `key` (slug estável, único), `label`, `category` (`compute`\|`database`\|`cache`\|`static`\|`storage`\|`ai`\|`email`\|`platform`\|`other`), `billing` (`fixed` = US$/mês × quantidade; `per_instance` = US$/mês por instância; `usage` = total do mês informado), `monthlyUsd` (componente de computação/plano, 0–100.000), `quantity` (manual, 0–100), `storage` = `null` (não se aplica) ou `{ gb (0–10.000) | null = tamanho a confirmar, usdPerGb }` com `usdPerGb` (0–10, **null = a confirmar**); `gb` ou `usdPerGb` nulos → o item soma só a computação e a resposta traz aviso `price_to_confirm`, `renderKey` (`api`\|`worker`\|`redis`\|`postgres`\|`static`\|null; liga o item ao snapshot), `planLabel` (texto, ex.: "Standard 1 CPU/2 GB"), `allocation` (`shared`\|`excluded`), `note`; tabela `renderPlanPrices[]` (`resourceType` `service`\|`postgres`\|`key_value`, `plan` como a Render devolve, `monthlyUsd`); `aiModelPrices[]` (`kind`, `model`, `inputPerMTokUsd`, `outputPerMTokUsd`). Até 40 itens, 60 planos e 60 modelos. Campo desconhecido → 400 com o campo |
| COST-02 | Sem linha salva, valores iniciais do código (tabela do Problema: api 25 + disco ? GB × ?; worker 25/instância, `quantity` 1; static 0; redis 20; postgres 19 + 15 GB × ?; workspace 0; R2/e-mail `usage` 0 a preencher; câmbio `null` = só US$) com origem `default`; a tela pede revisão. Valores iniciais são **ponto de partida**, rotulados "conferir no painel da Render" |
| COST-03 | `GET`/`PUT /admin/costs/settings` (super admin), `PUT` com `expectedUpdatedAt` (409), `updatedById` e auditoria `INFRA_COST_SETTINGS_CHANGED` com antes/depois. Sem segredo na configuração (sem id de recurso da Render) |
| COST-04 | P1 (sem job): `GET /admin/costs/summary?month=YYYY-MM` (super admin, só tabelas locais) devolve por item: quantidade efetiva e origem (`manual` \| `measured_now`), custo mensal em US$; total; custo fixo × variável; **custo marginal por sessão** = preço da instância do worker ÷ (`maxSessionsPerWorker` × `alertOccupancyRatio`) da configuração de escala. Instâncias do worker "agora" = instâncias distintas `worker_service` nas amostras da Render dos últimos 15 min (`ops_metrics_samples`), senão `quantity` manual |
| COST-05 | Rateio P1 (foto do momento): custo mensal ÷ sessões conectadas (última `sessions_connected`) e ÷ sessões contratadas (leitor de capacidade); por plano, parte de cada plano proporcional às sessões conectadas do plano (`PrismaWorkerCapacityReader`), custo por tenant médio do plano. Sem amostra ou sem sessão → `null`, nunca divisão por zero. Contratadas: entitlement ausente/não numérico = ilimitado (regra do leitor de capacidade); com algum tenant ilimitado, a leitura por contratadas fica `null` com aviso `unlimited_contracted` |
| COST-06 | Margem no painel: para cada plano, `preço de vitrine (R$) − custo por tenant em R$` para o mensal e o anual-equivalente de `PLAN_CATALOG`; rotulada "margem bruta de infraestrutura (sem gateway, impostos e IA da chave do tenant)". Sem cotação, a margem não aparece. A API nunca recebe nem devolve preço de plano |
| COST-06a | Cotação: a API devolve `fx = { rate, referenceDate, source: 'override' | 'ptax' | 'sgs' | 'last_known', fetchedAt, stale }` e cada número em USD e BRL (USD × `rate`). Ordem: override manual → PTAX do dia → SGS → última salva → sem cotação (só USD, aviso `fx_missing`). P1: só override. P2 (`fx.auto`): o job, num único processo (lease `infra-fx-rate`, §3.3), roda 1×/dia depois das 16h30 UTC (boletim de fechamento ~13h BRT): PTAX de venda pela Olinda com janela de 7 dias (`$orderby=dataHoraCotacao desc&$top=1`; fim de semana/feriado devolve `value: []`, a janela resolve); falhou → SGS série 1 (`ultimos/1`); falhou → mantém a última e tenta **uma** vez 1 h depois. Timeout 5 s, URLs fixas no código (sem SSRF), valor aceito só se número finito entre 1 e 20. Grava `infra_fx_rates` (`referenceDate`, `rate`, `source`, `fetchedAt`). `stale` = `referenceDate` com mais de 5 dias corridos; a tela mostra "cotação de DD/MM" e a atribuição "Fonte: Banco Central do Brasil (PTAX)" (ODbL). Mês fechado guarda `rate`, `referenceDate` e `source` usados (D7) |
| COST-06b | Arredondamento: cálculo em precisão cheia (USD com 6 casas internas, cotação com 4); a API devolve USD e BRL com 4 casas; o painel exibe 2 casas (`Intl.NumberFormat`, meio para cima) em totais, serviço, tenant e plano, e 4 casas quando o valor absoluto é menor que 0,01 (custo por sessão-hora). Percentual de margem com 1 casa. Somas sempre sobre os valores não arredondados |
| COST-07 | Aba **Resumo** em `/admin/costs`: cartões (total do mês, projeção, por sessão, marginal por sessão), tabela por plano com margem, tabela de serviços com plano, quantidade, origem e custo; selo "estimado" em todo número com entrada manual. cada valor em USD e em BRL lado a lado (BRL some só sem cotação), com a cotação, a data e a origem no topo |
| COST-08 | Aba **Preços** em `/admin/costs/prices`: edição da configuração com confirmação mostrando o diff, erro por campo, rascunho em `usePersistedState` (escopo `tab`) limpo ao salvar, 409 recarrega |
| COST-09 | P2: `InfraCostSnapshotJob` (papéis `worker`/`all`, lease `infra-cost-snapshot`, tick 5 min, grava uma vez por hora cheia UTC) lê da Render plano e instâncias de cada recurso mapeado em `INFRA_COST_RENDER_RESOURCES` (env só no `worker`, `chave=id`) e grava `infra_resource_hours` (`hour`, `resourceKey`, `plan`, `instances`, `suspended`). Liga só com `INFRA_COST_SNAPSHOT_ENABLED=true` + `RENDER_API_KEY`; timeout 5 s; 429 respeita `Retry-After`; hora perdida não é inventada (fica "sem leitura"). Idempotente por `(hour, resourceKey)` |
| COST-10 | P2: o mesmo job grava `tenant_session_hours` (`day` UTC, `tenantId`, `planSlug` do momento, `connectedHours`, `contractedSessions` último valor, `lastHour`): soma 1 hora × sessões `CONNECTED` com lease vivo do tenant, só se `lastHour < hora atual` (sem dobra em troca de dono do lease). Retenção 400 dias nos dois, limpeza diária por lease de 24 h, em lotes |
| COST-11 | P2: custo do mês = Σ por hora (preço mensal do plano lido ÷ horas do mês × instâncias) para itens com `renderKey`; hora sem leitura usa a quantidade manual e marca "estimado"; plano lido sem preço na tabela → aviso "plano X sem preço" e custo `null` daquele item (nunca 0 silencioso). Projeção = realizado + (última hora lida × horas restantes) |
| COST-12 | P2: rateio do mês por **sessão-hora**: custo compartilhado ÷ Σ `connectedHours` = custo por sessão-hora; × 730 = custo por sessão-mês. Por plano e por tenant = sessão-hora × custo. Segunda leitura por sessões contratadas. Capacidade ociosa = custo − parte usada (mostrado, não rateado) |
| COST-13 | P3: custo de IA da plataforma por tenant e por plano = `ai_usage_logs` (`source = PLATFORM`, `success`, mês) × `aiModelPrices` (modelo sem preço → aviso, não 0). Somado ao rateio como custo **direto** |
| COST-14 | P3: aba **Por cliente** em `/admin/costs/tenants`: lista paginada no servidor (cursor opaco) com nome, plano, sessões, sessão-hora, custo compartilhado, IA, total e margem (no painel). Nome com `Blurred` (flag `costs.tenantName`), ordenação por custo; filtro por plano persistido |
| COST-15 | P3: fechamento mensal `infra_cost_months` (mês, totais por item, por plano e câmbio usados) gravado pelo job na 1ª hora do mês seguinte (idempotente); mês fechado usa os preços daquele momento (edição posterior não reescreve). Mês corrente usa a configuração atual. Aba **Histórico** em `/admin/costs/history`: 12 meses, total e por plano |
| COST-16 | Filtros (mês, divisor sessão-hora × contratadas, plano) em `usePersistedState('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' })`. Textos em `features/infraCosts/strings.ts`, sem marca; modos sistema/claro/escuro pelo tema |
| COST-17 | Documentação: `docs/custos-infraestrutura.md` novo; linha em "Marca e domínios" do `AGENTS.md`; linha em "Ferramentas operacionais" do `docs/produto-roadmap.md`; `docs/ops-metricas.md` (job novo, envs, recorte da regra); `docs/arquitetura-escala.md` §3.3 (dono por job) e §5.1 (envs); `docs/planos.md` (margem lê o catálogo, preço segue fora do banco) |

## Fora do escopo

| Item | Motivo |
| --- | --- |
| Fatura real da Render/Cloudflare (conciliação) | Sem API pública de fatura; valor da tela é estimativa rotulada |
| Taxa do gateway (Cakto), impostos, receita real | Billing é da central (`arquitetura-central-billing.md`); a tela não sabe se o tenant paga mensal ou anual |
| Custo do PulsoSocial/central | Outro produto e outra infraestrutura |
| Câmbio automático | Chamada externa nova; câmbio manual com data basta |
| R2 por tenant | Chave do objeto não tem tenant; mudar o layout das chaves é outra feature |
| Decidir escala pelo custo | O escalador já tem teto de réplicas (`maxReplicas`) |

## Critérios de aceite (smoke, depois da última tarefa de cada fase)

1. **P1:** em ambiente local com Postgres descartável, sem linha salva, a aba Resumo mostra os 5 serviços com os valores iniciais, total US$ 89 (1 worker) com avisos `price_to_confirm` do disco da api e do storage do Postgres, custo por sessão com as amostras sintéticas, e a margem por plano depois de salvar um câmbio. Nenhuma chamada externa.
2. **P2:** com `fetchFn` falso da Render devolvendo 1 → 2 instâncias do worker no meio do mês sintético, o custo do worker é proporcional às horas; `tenant_session_hours` não dobra com dois processos disputando o lease.
3. **P3:** tenants com nomes borrados pela flag; IA de um tenant com 1 M tokens de entrada aparece como custo direto; o mês anterior fechado não muda ao editar um preço.

## Decisões

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1 | Página própria `/admin/costs`, item "Custos" na seção Plataforma | Aba em Workers | Escopo maior que workers |
| D2 | Preços em `platform_settings["infra_costs"]`; plano e instâncias medidos pelo job | Tudo manual / tudo da Render | A Render não dá preço; quantidade medida evita erro de digitação |
| D3 | Ids da Render só na env do `worker` (`INFRA_COST_RENDER_RESOURCES`); a configuração usa chaves lógicas | Id no banco/tela | Regra do escalador: id de serviço nunca em resposta, log ou evento |
| D4 | Rateio padrão por sessão-hora conectada; contratadas como segunda leitura | Só contratadas | Reflete uso real; ociosidade aparece separada |
| D5 | Margem calculada no painel com `PLAN_CATALOG` | Preço no banco | Regra de `docs/planos.md` |
| D6 | Preços em USD; API devolve USD e BRL; cotação PTAX automática com fallback (P2), manual na P1 | Só manual / guardar R$ | Decisão do dono (USD e BRL em todo número); PTAX é oficial e sem chave |
| D7 | Mês fechado congela preços e a cotação usada (valor, data, origem) | Recalcular sempre | Histórico não muda por edição de preço |
| D8 | Fase P1 sem tabela nova nem chamada externa | Começar pelo job | Tela útil já com os números de hoje |
| D10 | Componentes de armazenamento (disco da api, storage do Postgres) como campos do item, preço por GB nulo até o dono confirmar | Item separado por componente | Mantém um item por serviço na tabela; nulo gera aviso em vez de custo inventado |
| D9 | Linha nova "Custos da infraestrutura" em "Ferramentas operacionais" do roadmap | Sem item | Regra: feature nova cabe em item do roadmap |

## Perguntas ao dono

1. Tamanho do disco da `copysync_api` e o preço por GB do disco na Render (o disco ainda é usado? `arquitetura-escala.md` §5.1 prevê tirá-lo do caminho com mídia no R2).
2. Preço por GB do armazenamento do Postgres (15 GB hoje).
3. E-mail pela central: há custo atribuível ao CopySync (valor mensal fixo) ou entra como 0?
4. R2: valor do mês corrente no painel da Cloudflare (GB e operações) para o valor inicial.
5. Cotação USD→BRL: PTAX de venda do BCB automática com fallback SGS e override manual (recomendado) ou só manual? Qual cotação usar no mês: a do dia (mês corrente) e a do último dia útil do mês no fechamento (proposta), ou a média do mês?
6. Margem: comparar com o mensal, o anual-equivalente ou os dois (a tela não sabe o período pago pelo tenant)?
7. Rateio padrão: sessão-hora conectada (proposta D4) ou sessões contratadas?
8. Banda de saída e build minutes da Render: entram como item manual ou ficam fora?
