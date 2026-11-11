# Gestão de escala dos workers pelo super admin — Spec

**Fonte:** [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md) §3.2 (teto, heartbeat, alerta; "Autoescala (diferido)"),
§3.3 (dono por job), §5.1 (checklist e escada); E4 em [`../session-adoption/`](../session-adoption/spec.md); métricas em
[`docs/ops-metricas.md`](../../../docs/ops-metricas.md) e [`../ops-metrics-dashboard/`](../ops-metrics-dashboard/design.md).
**Tamanho:** Large. Desenho em [`design.md`](design.md); tarefas em [`tasks.md`](tasks.md). **Status:** Draft, aguarda aprovação do dono.
**Reabre** a decisão de 2026-11-04 ("autoescala diferida"): pedido do dono em 2026-11-11.

## Problema

O teto de sessões por worker (`WORKER_MAX_SESSIONS`) e os limiares de alerta são variáveis de ambiente lidas uma vez no
boot: mudar exige redeploy, que derruba as sessões. Subir réplica é manual no painel da Render e nada no produto mede
quando falta capacidade: sem adoção ligada não há heartbeat nem alerta, e o coletor de métricas não grava quantas
sessões estavam conectadas, então "MB por sessão" é chute. A tela de Workers só lê.

Medição de 2026-11-11 (produção, 1,5 dia de amostras): 8 tenants (6 MAX, 1 PRO, 1 LITE), 27 sessões contratadas,
18 conectadas, 1 processo `all` de 1 CPU/2 GB com ~1.020 MB de dia. Estimativa: ~35 MB por sessão em uso, ~30
sessões por instância a 70% da RAM. A pré-venda esgota isso com 2 a 3 clientes MAX.

## Objetivo

O super admin gerencia a capacidade pelo painel, sem redeploy: define o teto por worker e os limiares, vê a capacidade
contratada × usada × disponível, sobe ou reduz réplicas por decisão própria e, opcionalmente, liga a subida automática
com teto de custo. Com tudo no padrão (configuração nunca salva, escalador desligado), **nada muda** em relação a hoje.

**Limite conhecido:** o teto só é **aplicado** com a adoção ligada (`WORKER_ADOPTION_ENABLED=true`): sem ela o gate com teto
nem é criado (`sessionLeaseContainer.ts:130`) e não há heartbeat (`sessionAdoptionContainer.ts:92-93`). Produção hoje roda
sem adoção: ali a P1 guarda e mostra a configuração, a P2 mede e alerta, e o bloqueio por teto passa a valer quando a
adoção for ligada (D12).

## Alternativas avaliadas

| Tema | Alternativa | Veredito | Por quê |
| --- | --- | --- | --- |
| Onde fica o teto | Variável de ambiente alterada pela API da Render | ❌ | Só vale no próximo deploy (reinicia instâncias, derruba sessões) |
| | **Banco (`platform_settings`), lido em runtime com cache de 30 s** | ✅ | Vale sem reiniciar; tabela já existe; um valor para todas as réplicas |
| | Tabela nova por worker | ❌ | `workerId` é efêmero (muda a cada boot): override por instância não sobrevive |
| Quem escala | Autoescala nativa da Render | ❌ | Só CPU/memória, exige workspace Pro e ignora a escala manual; nosso sinal é sessões ÷ teto |
| | **Controlador próprio chamando `POST /services/{id}/scale`** | ✅ | Usa o sinal certo, com teto de réplicas, intervalo mínimo e histórico |
| Descida | Automática | ❌ | Render escolhe a instância encerrada; reconexão em massa sem ganho real agora |
| | **Só manual, com checagem de capacidade restante** | ✅ | Mantém a regra do doc ("descida só manual") |
| Sinal de sessões no histórico | Derivar de `worker_heartbeats` | ❌ | Vazio com adoção desligada (produção hoje) |
| | **Fonte nova no coletor, contando leases vivos no banco** | ✅ | Funciona em `all` e em `worker`, sem depender da adoção |
| Drenar worker | Pré-requisito da redução | ❌ | Não dá para escolher a instância que a Render encerra; o `SIGTERM` já drena |
| | **Opcional (manutenção/rebalanceio), fase P5** | 🟡 | Útil, mas não bloqueia nada |

## Requisitos

| ID | Requisito |
| --- | --- |
| WSCALE-01 | Configuração `WorkerScalingSettings` em `platform_settings` (chave `worker_scaling`, JSON validado no domínio): `maxSessionsPerWorker` (1–1000), `maxPendingLoginsPerWorker` (1–500), `alertOccupancyRatio` (0,5–0,95), `awaitingAlertSeconds` (30–3600), `scalerMode` (`off`\|`manual`\|`auto`), `minReplicas` (1–20), `maxReplicas` (≥ min, ≤ 20), `scaleUpSustainSeconds` (300–3600, resolução de 5 min: é o intervalo de gravação das amostras), `scaleCooldownSeconds` (300–86400). Campo desconhecido é rejeitado; fora da faixa → 400 com o campo |
| WSCALE-02 | Sem linha salva, o valor efetivo é o de hoje: `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` da env (viram só valor inicial), 0,8, 120 s, `scalerMode=off`. A resposta diz a origem de cada campo (`default` \| `saved`). Depois de salvo, o banco vence a env |
| WSCALE-03 | `IWorkerScalingSettingsProvider.current()` síncrono, alimentado por refresh a cada 30 s (`unref`) e na hora no processo que salvou. Falha de leitura mantém o último valor bom e loga `warn` sem dado sensível; nunca derruba adoção nem lease |
| WSCALE-04 | Com a adoção ligada, gate do lease, adoção, fila `session-open` do worker (`roleComposition.ts:98`), heartbeat e alerta leem o teto e os limiares do provider **a cada uso** (não no construtor). Mudança vale em todas as réplicas em até 30 s, sem reinício. Com a adoção desligada o teto não é aplicado (como hoje) e a API devolve `enforced: false` |
| WSCALE-05 | Reduzir o teto abaixo das sessões atuais **não derruba** sessão: o worker só para de adotar (ocupação > 100% visível). Aumentar libera vaga no próximo tick |
| WSCALE-06 | `GET /admin/workers/settings` e `PUT /admin/workers/settings` (super admin). `PUT` exige `expectedUpdatedAt` (409 se outro admin salvou antes), grava `updatedById` e auditoria `WORKER_SCALING_SETTINGS_CHANGED` com antes/depois |
| WSCALE-07 | Aba **Configuração** em `/admin/workers/settings`: formulário com faixa e ajuda por campo, confirmação antes de salvar mostrando o que muda, erro por campo, aviso quando o teto novo fica abaixo da ocupação atual, faixa "sem efeito até ligar a adoção" quando `enforced: false`, e confirmação reforçada (digitar o valor) quando o teto passa do `suggestedMaxSessions` ou não há amostra de RAM (na P1, sem a rota de capacidade, sempre) (regra "não subir o teto sem medir", `docs/arquitetura-escala.md` §6). Par mínimo–máximo de réplicas em `RangeSlider`. Rascunho em `usePersistedState` (escopo `tab`), limpo ao salvar |
| WSCALE-08 | Coletor grava a cada tick `sessions_connected`, `sessions_pending_login`, `sessions_awaiting` e `sessions_capacity` (fonte `sessions`, recurso `cluster`), contando no banco, em `all` e `worker`, com ou sem adoção. `sessions_awaiting` é 0 com a adoção desligada (ninguém adota nesse modo; mesma regra do `GET /admin/workers`) |
| WSCALE-09 | `GET /admin/workers/capacity`: por plano (`tenants`, `contracted` por canal, `unlimitedTenants`, `created`, `connected`) e do cluster (`capacity`, `connected`, `occupancyPct`, `headroom`, `requiredReplicas = ceil(connected ÷ (teto × ratio))`, `mbPerSession` e `suggestedMaxSessions` quando há amostra). `connected` aqui é a contagem do banco (lease vivo + `CONNECTED`), rotulada como tal; a aba Ocupação segue com a soma dos batimentos. `mbPerSession` = média de `memory` da Render em MB (recursos `srv-`, instâncias somadas) ÷ média de `sessions_connected` na janela; o limite de RAM sai de `memory ÷ memory_pct`. Sem métrica da Render (`RENDER_API_KEY`/`RENDER_RESOURCE_IDS`), sem sessões ou com mais de um serviço `srv-` sem `WORKER_SCALER_SERVICE_ID` (filtro entra na P3), `null`. Só tabelas locais, sem dado de tenant individual, `statement_timeout` 2 s |
| WSCALE-10 | Aba **Capacidade** em `/admin/workers/capacity`: cartões do cluster, tabela por plano, série de sessões × capacidade (7 dias) e projeção "cabem mais N clientes" por plano. Sem dado medido, mostra "sem amostra" em vez de número |
| WSCALE-11 | Porta `IWorkerScaler` (`getState`, `scaleTo`) com adaptador Render (`GET /services/{id}`, `GET /services/{id}/instances`, `POST /services/{id}/scale`). Liga só com `WORKER_SCALER_ENABLED=true`, `RENDER_API_KEY` e `WORKER_SCALER_SERVICE_ID` (nos serviços `http` e `worker`); senão o estado é `not_configured` e nenhuma chamada sai. Chave nunca em resposta nem log; timeout 5 s; 429 respeita `Retry-After` |
| WSCALE-12 | `POST /admin/workers/scale` `{ replicas, reason }` (super admin): exige `scalerMode ≠ off`, `min ≤ replicas ≤ max`, adoção ligada e intervalo `scaleCooldownSeconds` desde a última escalada bem-sucedida. Redução só se `(replicas × teto × ratio) ≥ conectadas`; senão 409 com os números. Idempotente por `requestId` |
| WSCALE-13 | Tabela `worker_scale_events` (`at`, `trigger` `manual`\|`auto`, `actorUserId` nulo = sistema, `fromReplicas`, `toReplicas`, `reason`, `outcome` `requested`\|`failed`\|`rejected`, `error` curto). `GET /admin/workers/scale/events` paginado por cursor opaco, sem identificar o ator (quem pediu fica na auditoria). Retenção 180 dias, limpeza diária no job da P4 |
| WSCALE-14 | Aba **Escala** em `/admin/workers/scale`: réplicas atuais × desejadas, estado do escalador (com a lista do que falta quando `not_configured`), botões subir/reduzir com confirmação e motivo, contagem até o fim do intervalo mínimo (`CooldownBar` + `serverNow()`), histórico |
| WSCALE-15 | `WorkerAutoscalerJob` (papéis `worker`/`all`, lease `worker-autoscaler`, tick 60 s): com `scalerMode=auto`, sobe **uma** réplica quando a ocupação fica acima de `alertOccupancyRatio` por `scaleUpSustainSeconds` ou há sessão aguardando capacidade há mais de `awaitingAlertSeconds`, respeitando `maxReplicas` e o intervalo mínimo. Nunca reduz. Cada subida vira evento; recusa repetida grava no máximo um evento por motivo por hora |
| WSCALE-16 | Estado do "sustentado" é derivado das amostras `sessions_*` no banco (não de memória do processo; o gatilho de aguardando é contado ao vivo no banco): reinício ou troca de dono do lease não zera nem duplica a contagem |
| WSCALE-17 | `WorkerHeartbeatJob` e `WorkerCapacityAlertJob` passam a usar os limiares da configuração. Sem adoção (`all` ou `worker`) o alerta de ocupação usa as métricas `sessions_*` (hoje não há alerta nenhum nesse modo) |
| WSCALE-18 | (P5, opcional) Drenar worker: `POST /admin/workers/{workerId}/drain` marca `drainRequestedAt` no heartbeat; o worker para de adotar e solta as sessões aos poucos (socket fechado → flush → lease solto). Recusa se o resto do cluster não tem vaga, salvo `force` |
| WSCALE-19 | Documentação: `docs/workers-escala.md` novo, linha em "Marca e domínios" do `AGENTS.md`, linha em "Ferramentas operacionais" do `docs/produto-roadmap.md`, `docs/arquitetura-escala.md` (§3.2 autoescala deixa de ser "diferida", §3.3 dono por job, §5.1 checklist e tabela de envs, §6 o que não fazer) e `docs/ops-metricas.md` (métricas novas; recorte da regra "rota nunca chama a Render" para as rotas de escala; envs do escalador) |

## Fora do escopo

| Item | Motivo |
| --- | --- |
| Ligar `PROCESS_ROLE=worker`, Redis, S3 e adoção em produção | É o checklist §5.1, decisão operacional do dono; esta feature funciona antes e depois |
| `WORKER_ADOPTION_ENABLED`, `PROCESS_ROLE`, `WORKER_SHARD`, `REDIS_URL` no painel | Topologia e kill switch ficam na env (`api/.env` local aponta para produção) |
| Redução automática de réplicas | Decisão: descida só manual |
| Teto diferente por instância | `workerId` é efêmero |
| E-mail de alerta ao super admin | Depende do envio pela central (H4); fica log + evento + tela |
| Escalar o serviço `http` ou o Postgres | `http` tem 1 réplica por desenho (§3.3); banco é outro plano |
| Outros provedores (Dokploy/Hetzner) | A porta `IWorkerScaler` permite; adaptador só o da Render agora |

## Critérios de aceite (smoke, depois da última tarefa de cada fase)

1. **P1:** em ambiente local com Postgres descartável e adoção ligada, salvar teto 25 na tela → em até 30 s o heartbeat e o gate usam 25, sem reinício. Com adoção desligada, a tela mostra "sem efeito" e nada muda. Sem linha salva, o comportamento é idêntico ao de antes do deploy.
2. **P2:** a aba Capacidade mostra as 27 contratadas, as conectadas e a série de sessões; `mbPerSession` aparece depois de 1 h de amostras.
3. **P3:** em API local com env sintético, Postgres descartável e adoção ligada, com o escalador configurado num serviço de teste, "Subir 1" muda `numInstances` na Render e gera evento; sem configuração, a tela explica o que falta e nenhuma chamada sai.
4. **P4:** com `auto`, ocupação acima do limiar pelo tempo configurado sobe uma réplica uma única vez dentro do intervalo mínimo.

## Decisões

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1 | Um teto global para todas as réplicas | Teto por instância | Instâncias são idênticas e o id é efêmero |
| D2 | Env `WORKER_MAX_SESSIONS` vira só valor inicial; documentada como obsoleta | Remover já | Remover muda o comportamento no deploy para quem nunca salvou |
| D3 | Redução de teto não derruba sessão | Derrubar o excedente | Derrubar cliente por ajuste de configuração é pior que ficar acima do teto |
| D4 | Subida automática de uma réplica por vez, descida só manual | Passo proporcional | Custo previsível; a Render cobra por segundo |
| D5 | `maxReplicas` limitado a 20 no código | Sem limite | Teto de custo contra erro de digitação |
| D6 | Linha nova "Gestão de workers" em "Ferramentas operacionais" do roadmap | Sem item | Regra: feature nova cabe em item do roadmap |
| D7 | Drenar worker fica opcional (P5) | Obrigatório antes de reduzir | A Render escolhe a instância encerrada |
| D8 | Kill switch `WORKER_SCALER_ENABLED` na env, além do modo no painel | Só o painel | `api/.env` local aponta para produção: sem a env, nenhum processo local chama a Render |
| D12 | Teto continua aplicado só com a adoção ligada; no modo `all` atual a proteção é o alerta de ocupação (WSCALE-17) | Aplicar o teto também sem adoção | Aplicar sem adoção muda a E3 em produção: a 41ª sessão passaria a ser recusada sem haver outro worker para assumir |
