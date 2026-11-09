# Desenho mínimo e entrega gradual

**Spec:** [spec.md](spec.md) · **Status:** proposto, implementação não iniciada.

## Arquitetura e evidências do código atual

| Ponto | Evidência |
|---|---|
| Um timer, um `running`, tick sem sobreposição | `api/src/modules/campaigns/infrastructure/worker/OfferDispatchWorker.ts:13–75` |
| Envio inteiro aguardado antes da captura | `api/src/app/server.ts:245–270` |
| Até 10 envios em série, timeout 60 s + digitação | `campaigns/application/use-cases/ProcessDueOfferDispatchesUseCase.ts:10–16,66–86,191–204` |
| Capturas em série, até 3; orçamento 10 s entre itens | `automation/application/use-cases/ProcessPendingCapturedOffersUseCase.ts:17–25,55–75` |
| Capturas globais FIFO, claim individual `SKIP LOCKED` | `automation/infrastructure/repositories/PrismaCapturedOfferRepository.ts:40–61` |
| Claims de envio: advisory lock, uma lane por sessão, menor `notBefore` | `campaigns/infrastructure/repositories/PrismaOfferDispatchRepository.ts:92–193` |
| Fonte idempotente `captured:<id>` | `ProcessPendingCapturedOffersUseCase.ts`, `campaigns/application/use-cases/EnqueueOfferUseCase.ts` |
| Jobs por papel e shutdown antes de mídia/sockets | `api/src/app/processJobs.ts`, `server.ts:405–501`, `app/shutdownBudget.ts` |
| Filas e índice já persistidos | `api/prisma/schema.prisma`: `CapturedOffer`, `OfferDispatch`, `Tenant` |

Autoridade: código e `docs/fila-de-envio.md`; `docs/arquitetura-escala.md` §3.3/3.6 descreve a
migração futura para filas de produto. Esta proposta apenas melhora o consumidor Postgres atual:
não cria mais um `setInterval` nem contraria essa direção. Há comentários antigos que confundem
o advisory lock dos envios com `SKIP LOCKED`: corrigir na entrega A.

Outras limitações identificadas: só mensagens novas `notify` emitem captura; histórico `append`
não é retroprocessado. Mídia/miniatura podem ser aguardadas antes do evento. Isso pode explicar
ausência/atraso antes da fila e não será resolvido por este plano. O incidente da conta não teve
diagnóstico de latência individual: não atribuir a ela uma causa comprovada apenas por este desenho.

## A — um timer e duas execuções independentes

Reusar `OfferDispatchWorker` e os dois use cases. A cada tick, iniciar apenas as etapas habilitadas
que estejam livres; guardar uma promise de execução por etapa. Rodada de captura pode recomeçar
mesmo se um envio da rodada anterior estiver aguardando I/O. Não usar um único `running` sobre
`Promise.all`, pois isso preservaria o bloqueio entre rodadas.

- Flag proposta `OFFER_WORKER_INDEPENDENT_STAGES_ENABLED=false`: false preserva a composição
  sequencial atual; true usa dois slots. As flags existentes continuam mandando em cada etapa.
- Mesma cadência de 2 s, mesma classe, captura serial e envio serial na primeira ativação.
- Opções da classe distinguem modo legado e etapas nomeadas; a composição só fornece um modo.
  Testar a composição sem subir servidor, engine, Redis ou banco.
- Os controles `running`, parada e promises são recursos transitórios de execução. A fonte de
  verdade de item, fila, turno, posse e recuperação continua no Postgres.

### Parada e trabalho já em voo

Adicionar `AbortSignal` opcional ao contexto de execução dos dois use cases, com verificações
cooperativas antes de novos claims e antes de iniciar novo envio/enqueue. Não adicionar sinal
obrigatório aos chamadores atuais nem trocar resultado desconhecido por erro recuperável.

`stop()` marca parada e limpa o timer primeiro; sinaliza ambas as etapas antes de aguardar qualquer
uma; espera as promises sob um único teto de até 10 s, limitado pelo orçamento restante já reservado
para o shutdown. Não adicionar 10 s de espera por etapa nem consumir a reserva de sockets/flush.
O cálculo do orçamento deve respeitar o tempo já gasto antes do worker, sem habilitar adoção.

- Um claim iniciado antes da parada pode retornar depois dela. Não iniciar novos efeitos de envio
  nesse caso: o item permanece recuperável pelo stale existente de 5 min, sem virar FAILED por parada.
- Captura interrompida antes de `enqueue`: deixar PROCESSING recuperável pelo stale; não classificá-la
  como erro de marketplace/INTERNAL_ERROR. Não renovar sua validade ao retomar.
- Se enqueue ou sender já começou, a parada não o desfaz. Concluir resultado/token quando possível;
  se enqueue concluiu, `markQueued` ainda deve ocorrer mesmo com sinal abortado.
- `Promise.race` limita espera, não cancela rede. Antes do drain, nenhuma continuação tardia poderá
  iniciar outro envio/enqueue após observar parada. Operações já iniciadas podem apenas terminar.
- Queda após efeito e antes da marcação preserva o risco at-least-once já documentado; não alegar
  eliminar duplicidade em falha abrupta. Manter `sourceKey`, `claimToken`, eco e mídia PENDING.

### Métricas com baixo custo

Reusar logger e relógio injetado; sem tabela, endpoint, pacote ou polling de backlog adicional.
Observar por item já reivindicado: `captureAgeMs` desde `capturedAt`, tempo de preparação,
`dispatchOverdueMs=max(0,agora-notBefore)`, tempo de envio, resultado e código interno. Idade da
captura não é latência WhatsApp→evento; atraso de envio não é tempo total desde a criação.

Separar espera planejada/janela/offline de execução ao analisar; não chamar atraso intencional de
lentidão do worker. Um resumo por minuto usando o timer existente informa contagens, etapas
ocupadas, CPU via `process.cpuUsage()` e RSS via `process.memoryUsage().rss`. Reusar heartbeat
apenas quando já habilitado; não ligar adoção só para medir. p50/p95 calculados fora do processo a
partir dos logs, sem arrays de amostras ou mapas por tenant que cresçam indefinidamente.

Não logar texto, links, títulos, nomes, número, foto, credencial ou corpo de erro bruto. IDs apenas
para correlação, sem labels de métricas por tenant. Logs de resultado por item e resumo limitado;
falha da observação não muda o resultado da fila nem provoca retry.

## B — concorrência de envio opt-in, sem estoque de claims

Somente depois dos gates de A. `OFFER_DISPATCH_CONCURRENCY` proposto: inteiro 1–2, default 1;
valor 2 exige etapas independentes habilitadas. Default 1 conserva o caminho serial legado;
o executor novo e as reservas de sender só entram com valor 2. Não paralelizar capturas.

No executor novo, reivindicar ondas de até as vagas livres de chamadas ao sender, processar cada onda com
concorrência limitada, repetir até dez itens por rodada. `now` novo por claim; uma lista de
sessões já escolhidas na rodada (máximo dez) impede repetir a mesma sessão. Unir a essa exclusão
as sessões das chamadas originais ao sender ainda pendentes entre rodadas (máximo duas), mesmo
quando já marcadas SEND_TIMEOUT e o hold de 120 s venceu. Estender o contrato
de `claimDue` com exclusões opcionais, vazio = comportamento anterior. Legado sem sessão mantém
seu tratamento atual. Todos os itens claimados começam sua execução sem esperar numa fila local.

Reservar vaga antes de iniciar `sender.send`. Liberar em `finally` da promise original do sender,
não no timeout do `Promise.race`. A reserva continua válida entre rodadas. Se o resultado deu
SEND_TIMEOUT, manter marcação, hold mínimo de 120 s da sessão e ausência de retry automático.
Não reaproveitar vaga ocupada por chamada ao sender de resultado desconhecido.

O limite cobre a porta `IOfferMessageSender.send`, não entrega/transferência de mídia: no modo
MEDIA, `ChatOfferMessageSender` devolve após enfileirar, antes da transferência acabar. A fila
de mídia mantém `MEDIA_SEND_CONCURRENCY`/`MEDIA_SEND_PER_SESSION` atuais. Não alterá-la nem
alegar um teto de duas transferências. Acrescentar regressões MEDIA e LINK_PREVIEW/texto.

Promessa que nunca termina mantém a vaga ocupada: estado degradado explícito, sem busy loop ou
novas reservas ilimitadas. Resumo informa `unsettledSenders`/idade; alertar no máximo uma vez por
minuto se a ocupação exceder 120 s. Se as duas vagas permanecerem assim, parar a ativação e aplicar
restart controlado com o runbook de leases/drain existente, depois de conferir os resultados das
mensagens. Não transformar essa recuperação em retry automático ou religar processos por código.

As reservas são transitórias da execução local, limitadas a duas promises com seus IDs de sessão. Fila e resultado continuam
externos, com hold/claims no banco. Documentar essa distinção em `arquitetura-escala.md` §3.6.
O limite é por processo. B só pode ser ativada com um consumidor de ofertas, sem instâncias antigas
sobrepostas; conferir isso no rollout. Depois de crash/restart ou entre processos, valem as garantias
atuais de claim/hold e os riscos de resultado desconhecido, sem exclusão física indefinida. Não ampliar
B para múltiplos consumidores sem um desenho durável adicional para esse caso, fora deste escopo.

Ondas fazem até dez claims para dez itens (cinco com duas vagas sempre livres), mais no máximo uma
busca vazia final, em vez do claim único atual: medir consultas/segundo, advisory lock e pool também
com uma vaga presa. Preservar refill evita reduzir tudo a dois envios por tick.

## C — turno persistido, sem round-robin em memória

Ativar apenas se A mostrar espera desproporcional entre tenants. Não depende da ativação de B.
Flag proposta `MONITORING_FAIR_CLAIM_ENABLED=false`, injetada pelo container no repositório; flag
falsa mantém a query atual. Criar migration aditiva com `Tenant.monitoringClaimTurn BigInt?` e
sequência Postgres `monitoring_claim_turn_seq`. Sem backfill de produção; campo de controle de
infra sem exposição no painel/DTO de tenant. BigInt evita empates de timestamps em milissegundos.

`claimPending(1, staleBefore)` no modo justo usa uma transação curta:

1. Selecionar tenant com captura elegível pela mesma regra atual (PENDING ou PROCESSING stale),
   ordenado por `monitoringClaimTurn ASC NULLS FIRST, id`, com lock do tenant e SKIP LOCKED.
2. Selecionar a captura dele por `capturedAt,id`, com lock e SKIP LOCKED.
3. Se achou item, gravar PROCESSING/token/claimedAt (horário do banco) e atualizar o turno do tenant
   com `nextval('monitoring_claim_turn_seq')` na mesma transação. Não usar `Tenant.updatedAt`.
4. Se nenhum item foi obtido, não alterar o turno persistido. Falha reverte ambas as linhas; números
   consumidos da sequência podem deixar lacunas, que não afetam a ordem. Sem rede sob lock.

Não mudar `claimPending` para lotes pré-reivindicados. O consumidor atual pede um item por vez;
no modo justo, limitar o claim efetivo a um e documentar isso no contrato. Usar índice existente
tenant/status/capturedAt; conferir EXPLAIN no banco descartável. Só adicionar índice novo na mesma
migration se o perfil representativo justificar; não agregar todo o histórico a cada claim.

O lock de tenant também é usado pelo billing: transação sem I/O, timeout curto explícito e teste
de contenção para não segurar assinatura/provisionamento. Turno governa escolha, não tempo de
conclusão. Marketplace lento ainda ocupa o único slot de captura. Envio permanece FIFO por lane.
`SKIP LOCKED` pode pular um tenant travado externamente: o limite de N seleções assume ausência
dessa contenção. Testar progresso dos outros e atendimento do tenant assim que o lock for liberado,
sem avançar seu turno indevidamente ou impor o limite N durante a contenção.

## D — gate da ingestão do chat por entitlement e coluna `lid`

Não remover o módulo chat. Gate = `IEntitlementReader.getBoolean(tenantId, 'chat_enabled')` (porta já
existente em `tenants/domain/contracts/IEntitlementReader.ts`; ausente = false) com cache em memória TTL 30–60 s (sem evento de invalidação: `SyncTenantEntitlementsUseCase` só faz
upsert e roda no `http`; a ingestão roda no dono da sessão). Aplicado **dentro dos use cases de
ingestão**, para cobrir os dois caminhos do adapter: `IngestIncomingMessageUseCase` (`notify`, só
upsert de `ChatContact` e retorna) e `IngestHistorySyncUseCase` (`append`, `adapter:1286`; `execute` é síncrono, gate entra em
`processChunk` `:118`, não grava nada). Composição única: `server.ts:336` **e**
`localEngineContainer.ts:35`/`MessagingEngineFactory.ts:43–54` criam ingestão/adapter separados; gate e
política saem de um único factory usado pelos dois, senão o `append` do worker fica sem gate. Listeners de status, reação, presença, avatar e estado de conversa (`server.ts:336–353`)
retornam cedo pelo mesmo gate. Bus, `MESSAGE_RECEIVED` e `GroupMonitoringMessageListener` intactos.

Mídia recebida: o download acontece no adapter **antes** do bus (`adapter:1331–1335`) e
`shouldAutoDownloadGroupMedia` devolve `true` para 1:1 (`:1918`); gate em listener não impede nada.
A decisão passa a uma porta do messaging `IIncomingMediaPolicy.shouldDownload({tenantId, sessionId,
isGroup, groupJid, msgType})` injetada no adapter (usada em `:1333`, no `append` `:1691`/`:1704` e nos flags de prévia) e no adapter
Telegram (`:715`/`shouldDownloadMedia :746`, hoje baixa 1:1 sempre), com
implementação fora do adapter que compõe: `chat_enabled` → regra atual; senão → só `IMAGE` de grupo
monitorado (consulta ao catálogo de monitoramento com cache). Motivo: `RegisterCapturedMessageUseCase.ts:49`
usa `m.mediaUrl` como `sourceMediaUrl` e `ProcessPendingCapturedOffersUseCase.ts:217–222` prefere essa
foto à do produto; sem download toda captura com foto cairia para a imagem do produto.

Envio e eco: `SendMessageUseCase` e `sendStoredMediaMessage` continuam; 1 escrita por disparo.
Status `PENDING→SENT` é pelo retorno do envio; eco só deduplica. Marca de eco esperado (texto `:601`,
mídia `:662`) hoje só é consumida no `append` (`isOwnOutboundEcho`, `:1651`); passa a ser consumida
também no `notify`, antes do download e do bus. Eco 1:1 `fromMe` então não baixa mídia nem chega ao
chat quando desligado. Mudança no adapter, coberta por teste.

`lid`: contrato `MESSAGE_RECEIVED` ganha `authorLid?` (adapter preenche de `participant @lid`, `:1844–1848`,
que hoje é descartado por `extractParticipantJid`); emissor Baileys/Telegram/remoto e consumidores
atualizados juntos, CHANGELOG (AGENTS §36). Migration aditiva `chat_contacts.lid TEXT NULL` + índice
`(tenantId, lid)`; gravado no upsert; sem backfill. Resolução de menção/citação consulta
`findByLid` antes de pedir à engine; miss cai no caminho atual. Flag única
`CHAT_INGEST_ENTITLEMENT_GATE_ENABLED=false`: false = comportamento atual para todos; coluna `lid` é
gravada independentemente da flag.

| Entrega | Ativação | Reversão |
|---|---|---|
| D | migration no boot Render; flag true após hub publicar `chat_enabled` para super admin/teste | flag false + restart; coluna `lid` permanece; nada a reprocessar |

Gate de ativação: tenant sem chat, por mensagem de grupo: escritas caem de ~4 para 2 (contato +
captura), zero download; suíte do chat com entitlement true sem diff; smoke de disparo MEDIA/texto/
LINK_PREVIEW com eco observado.

## E — métricas de recursos fora do caminho do usuário

Princípio: medir só em job do `worker`, um dono por vez (`IJobLease` `ops-metrics-sampler`, como
`WorkerCapacityAlertJob`), baixa frequência, agregado em memória, persistência rara.
Fonte de CPU/RAM real do container e do Postgres é a Render Metrics API (dados por minuto); o
`process.cpuUsage()` mede só o Node e fica como complemento no heartbeat. Chave em `RENDER_API_KEY`,
nunca exposta ao painel; IDs de recurso em `RENDER_RESOURCE_IDS`.

- **Heartbeat** (`WorkerHeartbeatJob.ts`): colunas aditivas `cpuPct`, `eventLoopP99Ms`, `poolInUse`.
  Migration aditiva em `worker_heartbeats`; grava junto do RSS já existente.
- **Sampler** (`sessions/infrastructure/jobs/OpsMetricsSamplerJob.ts` ou módulo `metrics/`): porta
  `IPlatformMetricsSource` (implementação Render) e `IDatabaseStatsSource` (Prisma `$transaction([$executeRawUnsafe('SET LOCAL statement_timeout = \'2s\''), $queryRaw…])`:
  fora de transação o `SET LOCAL` é autocommit e some; padrão de `PrismaSessionLeaseRepository.ts:53`; teste prova o timeout).
  Chamadas à Render com `AbortSignal.timeout` (padrão `HubOutboxWorker.ts:104`). Timer próprio de 60 s com `unref()`, `stop()` cooperativo
  sob o orçamento de shutdown existente. Ring buffer fixo (60 amostras) é **cache** de `ops_metrics_samples`, exceção declarada à regra de
  escala (perda ≤ 5 min em crash aceita); persistência a cada 5 amostras. Lease: `PrismaJobLease.ts:16`
  só reaquire após `expiresAt`, então TTL do `ops-metrics-sampler` = 45 s (< intervalo de 60 s) e
  `release()` no `stop()`; sem isso a amostragem vira período do TTL. `stop()` é sinalizado junto do
  bloco keeper/adoção (`server.ts:436–453`) e aguardado em `Promise.all` com os demais, não em série
  (reserva de 10 s de `shutdownBudget.ts:7`); `heartbeat.stop()` real fica em `:527`, após leases.
- **Tabela** `ops_metrics_samples(id, at, source, resource, metric, value, meta jsonb)` sem tenant
  (dado de infraestrutura); índice `(metric, at)`; delete `at < now() - 7d` no mesmo tick.
- **Alertas**: novo avaliador ao lado de `capacityAlertReason` (que só conhece ocupação); streak
  "CPU ≥ 80% por 5 min" e limite de RAM lidos de `ops_metrics_samples`/Render API (`OPS_MEMORY_LIMIT_MB`
  fallback). Silêncio 30 min por limiar via `IJobLease` `ops-alert:<reason>` (cluster-wide, como o
  cooldown de `worker-capacity-alert-email`). Só log: `ICapacityAlertNotifier` não tem implementação
  de produção e não há template na central (escala §3.2 D5); e-mail entra quando o template existir.
- **Rota** `GET /ops/metrics?metric=&from=&to=` só super admin, paginada por cursor assinado; tela
  super admin fora deste plano (ler via Render enquanto não existir).

Referência a confirmar antes de T17: Render API `GET /v1/metrics/cpu|memory?resource=<id>`
(https://api-docs.render.com/reference/get-cpu); cobertura de Postgres a validar lá.
Custo esperado por minuto no worker dono: 3 HTTPs externos + 3 consultas de catálogo do PG (< 5 ms cada,
`pg_stat_statements` já habilitado na Render). Zero no `http`.

| Entrega | Ativação | Reversão |
|---|---|---|
| E | migration no boot; `OPS_METRICS_SAMPLER_ENABLED=true` só no worker após `RENDER_API_KEY` | flag false; tabela fica; retenção limpa sozinha |

## Rollout, limites e rollback

Flags só na Render após deploy versionado. Nenhuma ativação faz parte deste planejamento.

| Entrega | Ativação | Reversão |
|---|---|---|
| A | publicar com flag false; baseline; true com envios/captura seriais | flag false + restart controlado; mesmas tabelas/status |
| B | após A estável, 1→2 com um único consumidor de ofertas, sem sobreposição de versões | 2→1 + restart controlado; considerar senders de resultado desconhecido |
| C | migration pelo boot normal Render; atualizar todos os consumidores; ativar flag de todos, sem misturar modos para avaliar justiça | false + restart; manter coluna/sequência, sem downgrade destrutivo |

Baseline e candidato: mesma carga em staging/local descartável, 3 repetições, 10 min cada, comparar
a mediana dos p95/CPU/RSS; testar vazio, uma sessão, dez sessões e sete tenants com backlog desigual.
Para A, envio artificialmente preso por 60 s não impede ao menos três rodadas de captura rápidas
em 10 s de relógio virtual (sem I/O real). Para B, capacidade máxima de chamadas comprovada por
spies da promise original do sender, inclusive após timeout >120 s; manter excluída essa sessão com
outra vaga livre. Validar MEDIA/texto/LINK_PREVIEW; throughput rápido não pode cair >5% contra baseline.
Para C, cumprir teste N-tenant do spec e EXPLAIN com 10 mil capturas locais e distribuição desigual.

Limites propostos para ativação, medidos com as mesmas versões/dados: RSS p95 ≤ baseline +15% e
≤80% da RAM do container; CPU p95 ≤ baseline +10 pontos percentuais e ≤80%; p95 de operações de
banco ≤ baseline ×1,20, sem timeout de pool/lock; falhas não aumentam no cenário determinístico.
Registrar contagem de claims e observações de recuperação para interpretar o custo. Se baseline
já exceder limites absolutos, não ativar a próxima etapa. São gates de rollout, não SLA de produto.
Só ampliar após janela observada de 30 min em carga representativa, sem mudança simultânea de réplicas.

## Trabalho local e ferramentas

Usar `tlc-spec-driven` e `/caveman-review`. `codenavi`/`mermaid-studio` não foram encontrados;
`rg` e o grafo textual de tarefas bastam. Instalação de codenavi é opcional para navegação futura.
Sem MCP de banco necessário; nada deste plano requer credenciais ou leitura/escrita de produção.

RAM do Mac: amostrar `vm_stat` a cada 5 s; estimativa de uso não recuperável =
`(Anonymous pages − Pages purgeable + Pages wired down + Pages occupied by compressor) × pageSize / RAM`.
Excluir cache recuperável evita confundir o `PhysMem used` de `top` com o uso efetivo; a estimativa
não substitui pressão de memória/swap do macOS. Conferir pressão se houver dúvida. Medição segue
a distinção da [Apple entre memória em uso e cache](https://support.apple.com/en-ie/guide/activity-monitor/actmntr1004/10.14/mac/15.0).
Não iniciar subagente/teste/carga com ≥88%; se atingir 88%, interromper primeiro nossa carga de
teste e reduzir agentes; retomar abaixo de 85%. Em ≥90%, parar nosso trabalho de carga imediatamente
e solicitar liberação de recursos. Outros aplicativos podem alterar o total entre amostras: não
garantir controle sobre eles. Máximo cinco subagentes no trabalho; no máximo dois simultâneos aqui.
