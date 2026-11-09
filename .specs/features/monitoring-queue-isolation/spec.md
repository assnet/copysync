# Filas de ofertas: independência e capacidade limitada

**Data:** 2026-11-08 · **Status:** implementado atrás de flags desligadas (api 0.74.0, 2026-11-09); gates de produção de A/B/C pendentes; D/E aguardam ativação na Render.
**Branch:** `feature/monitoring-queue-plan`.
**Roadmap:** itens 3/4/7 (gerador, monitoramento, reescrita); evolução operacional, sem produto novo.

## Problema e objetivo

O recebimento de mensagens já é orientado a eventos por sessão, mas envio e preparação das capturas
compartilham um único tick sequencial. Até dez envios precedem até três capturas. Digitação, rede e
timeouts de outro tenant podem atrasar a preparação de uma oferta já capturada.

Remover esse bloqueio com o menor incremento: manter processo, banco, timer e filas existentes.
Primeiro medir e separar etapas; aumentar capacidade e mudar a seleção entre tenants apenas em
entregas posteriores, com critérios próprios de ativação. Não prometer custo zero nem ausência
absoluta de regressões: exigir evidências automatizadas e operacionais antes de cada ativação.

## Entregas e critérios de aceitação

### P1 / entrega A — captura independente e observabilidade

Como operador, quero que a preparação de ofertas continue quando um envio estiver lento.

| ID | WHEN / THEN / SHALL |
|---|---|
| MQ-01 | Quando o envio estiver pendente, rodadas posteriores de captura deverão continuar; o inverso também. Cada etapa terá no máximo uma execução do seu use case em curso por worker. |
| MQ-02 | Quando uma etapa falhar, a outra deverá continuar. O timer atual de 2 s será reutilizado, sem novo serviço, timer, broker ou fila em memória. |
| MQ-03 | Quando papel/flags impedirem uma etapa, ela não deverá iniciar. `http` não executará ofertas; `all`/`worker` preservarão `jobsFor` e as flags atuais. |
| MQ-04 | Quando receber parada, o worker deverá impedir novos ticks/claims iniciados depois da sinalização, interromper o início de novos efeitos cooperativamente e aguardar ambas as etapas sob um teto compartilhado. I/O já iniciado não é cancelado por uma espera com timeout. |
| MQ-05 | Quando processar itens, deverá observar idade/atraso, duração, resultado e uso de recursos com logs estruturados limitados, sem conteúdo, URL, credencial ou e-mail. |
| MQ-06 | Em pausa, cancelamento, janela, agendamento, expiração, plano, offline, flood, timeout ou perda de posse, deverão continuar válidas as regras existentes, incluindo os mesmos tokens e chaves idempotentes. |

**Teste independente:** manter o sender pendente por várias rodadas com promises controladas; a
captura deverá completar novas rodadas sem liberar o sender. Repetir invertendo as etapas.

### P2 / entrega B — dois envios entre sessões, somente após A medida

| ID | WHEN / THEN / SHALL |
|---|---|
| MQ-07 | Quando a concorrência configurada for 2, limitar a duas chamadas pendentes de `IOfferMessageSender.send` por processo, excluindo também as sessões das chamadas que continuem pendentes após timeout. Preservar cooldown/posse no banco; isso não limita transferências da fila de mídia nem garante exclusão física indefinida após queda entre processos. B só será ativada com um consumidor de ofertas. |
| MQ-08 | Quando houver capacidade, reivindicar somente as vagas disponíveis, com `now` atualizado; reabastecer até dez itens/rodada, mantendo no máximo um candidato por sessão/rodada. Não pré-reivindicar dez para esperar num pool. |
| MQ-09 | Quando um sender exceder o prazo, marcar o resultado conforme a regra atual, sem retry cego; sua vaga continuará ocupada até a promessa original terminar. Se não terminar, alertar e aplicar o procedimento de recuperação, sem fila crescente em memória. Essa política nova só opera no modo B. |

**Teste independente:** duas sessões distintas progridem juntas; uma terceira espera vaga. Testar
sender atrasado além do timeout e sender que nunca termina, inclusive entre rodadas diferentes.

### P2 / entrega C — seleção justa de capturas, condicionada à medição

| ID | WHEN / THEN / SHALL |
|---|---|
| MQ-10 | Quando vários tenants tiverem capturas elegíveis, escolher o menos recentemente atendido, persistindo um turno BigInt monotônico no Postgres. Dentro dele, escolher `capturedAt, id`. Com um conjunto estável de N tenants continuamente elegíveis e um worker, sem novas entradas no conjunto e sem contenção externa de locks, todos deverão ter uma seleção nas primeiras N seleções bem-sucedidas. |
| MQ-11 | Com múltiplos workers ou restart, turno e posse deverão continuar atômicos e persistidos. Quando o claim falhar/reverter, não avançar o turno. Não prometer ordem de conclusão, fairness do envio ou SLA fixo. |

**Teste independente:** sete tenants, lote máximo três, backlog desbalanceado; duas rodadas completas
de atendimento sem consumir todo o backlog de um tenant. Repetir claims concorrentes e restart.

### P2 / entrega D — ingestão do chat por entitlement e par telefone↔LID

Como operador, quero que tenant sem o produto Chat não pague a ingestão do chat por mensagem recebida,
sem perder contato nem captura. Análise 2026-11-09: monitoramento ouve só `MESSAGE_RECEIVED`
(`GroupMonitoringMessageListener.ts:21`) e não lê tabelas do chat; disparo usa `SendMessageUseCase`,
`sendStoredMediaMessage` e `conversationRepo` (linha do grupo no catálogo). Mídia `PENDING` vira
`SENT` pelo retorno do `sendMessage` (`DispatchOutboundMediaUseCase.ts:81–82`), não pelo eco: o eco
só deduplica na ingestão. Revisão 2026-11-09 achou: `append` grava direto por `IngestHistorySyncUseCase`
(`adapter:1286`), download roda **antes** do bus (`adapter:1331–1335`) e a imagem da captura é o
`mediaUrl` baixado pelo chat (`RegisterCapturedMessageUseCase.ts:49`). Chat hoje é só super admin (`navigation/model.ts:102`).

| ID | WHEN / THEN / SHALL |
|---|---|
| MQ-16 | Quando o tenant não tiver `chat_enabled`, `IngestIncomingMessageUseCase` deverá gravar apenas o contato (`ChatContact`, upsert por `tenantId+phone`) e pular conversa, mensagem, não lidos e push WS; `IngestHistorySyncUseCase` (`append`) não deverá gravar nada; listeners de reação, presença, avatar e estado de conversa retornam cedo. `MESSAGE_RECEIVED` e a captura continuam iguais. |
| MQ-17 | Quando o tenant não tiver `chat_enabled`, a decisão de download no adapter (`IIncomingMediaPolicy`, antes do bus) deverá baixar **somente imagem de grupo monitorado** (`sourceMediaUrl` da captura depende desse download); 1:1, vídeo, áudio e documento não baixam. Vale para `notify` (`:1333`) **e** `append` (`:1691`, `:1704`) e para o adapter Telegram (`TelegramMessagingEngineAdapter.ts:715/746`). Com `chat_enabled`, comportamento atual. |
| MQ-18 | Quando o tenant não tiver `chat_enabled`, envio de oferta (texto, LINK_PREVIEW, MEDIA), catálogo de grupos e eco deverão funcionar como hoje; marca de eco esperado no adapter (texto `:601`, mídia `:662`) passa a ser consumida no `notify` antes do download/bus (hoje só no `append`, `:1651`); mudança registrada, não só verificação. |
| MQ-19 | Evento `MESSAGE_RECEIVED` ganha `authorLid?` (contrato interno: emissor + consumidores + CHANGELOG, AGENTS §36); `ChatContact` deverá ganhar coluna opcional `lid` (migration aditiva, sem backfill), gravada quando o adapter resolver `participant @lid` ↔ `participantAlt`; a chave única continua `tenantId+phone`. Resolução de menção/citação deverá consultar o par antes de pedir à engine. |
| MQ-20 | Entitlement `chat_enabled` (chave nova; ausente = false) lido via `IEntitlementReader.getBoolean` existente, sem porta nova; super admin/tenant de teste true, lido de `tenant_entitlements` com cache em memória de TTL 30–60 s (não há evento de invalidação entre processos; webhook roda no `http`, ingestão no dono da sessão); sem UI nova; chat ligado = comportamento atual byte a byte. |

**Decisões da implementação (2026-11-09):** grupo com chat desligado não grava contato (o caminho de
grupo nunca fez upsert de participante; Saver cuidará dos membros); `fromMe` não baixa mídia; DELIVERED/READ
não são gravados sem chat (disparo usa só SENT/FAILED do retorno); falha ao ler entitlement = chat ligado.
`lid` (MQ-19) é gravado no caminho 1:1; par LID de participante de grupo fica para o Saver.

**Teste independente:** tenant sem chat recebe mensagem de grupo monitorado com imagem: 0 contato,
1 captura, 1 download (imagem de grupo monitorado), zero `chat_messages` inclusive via `append`; mensagem 1:1 com vídeo: zero download; disparo MEDIA conclui `SENT` e eco não grava
nada nem vaza marca. Tenant com chat: suíte atual intacta. LID: mensagem com `@lid` grava `lid` e a
menção seguinte resolve sem chamar a engine.

### P2 / entrega E — métricas de recursos dos workers e do banco, sem custo ao usuário

Como operador, quero ver CPU, RAM, event loop, pool e saúde do Postgres por processo, medidos fora
do caminho das requisições, para calibrar A/B/C/D com dados.

| ID | WHEN / THEN / SHALL |
|---|---|
| MQ-21 | O `WorkerHeartbeatJob` (20 s, já existe) deverá acrescentar CPU (delta de `process.cpuUsage()`) e p99 do `monitorEventLoopDelay` à linha de `worker_heartbeats`, colunas **nullable** (deploy sobreposto com imagem antiga); sem pool Prisma (`$metrics` exige preview feature): conexões vêm de `pg_stat_activity` em MQ-22. `stop()` apaga a linha: histórico só em `ops_metrics_samples`. |
| MQ-22 | Um job `opsMetricsSampler` só no `worker`, a cada 60 s, deverá ler Render Metrics API (`/v1/metrics/cpu`, `/memory`, recursos da API, worker e Postgres) com `RENDER_API_KEY`, e 3 consultas leves ao Postgres (`pg_stat_database`, `pg_stat_activity` agregado, top 10 de `pg_stat_statements`) dentro de `$transaction` com `SET LOCAL statement_timeout = '2s'`. Dono único via `IJobLease` (`ops-metrics-sampler`): com N workers só um amostra. Nunca no `http`, nunca em requisição. Endpoints a confirmar na doc oficial da Render antes de T17. |
| MQ-23 | Agregado em ring buffer de 60 min em memória e persistido 1 linha a cada 5 min em `ops_metrics_samples` com retenção de 7 dias apagada pelo próprio job. O ring buffer é exceção declarada à regra de escala (cache da tabela; perda ≤ 5 min em crash aceita). Sem PII, sem texto de query além do `queryid`/forma normalizada truncada. |
| MQ-24 | `capacityAlert` (já existe) deverá avaliar limiares: RSS ≥ 80% do container, CPU ≥ 80% por 5 min, `idle in transaction` ≥ 3, event loop p99 ≥ 200 ms; alerta por log estruturado; e-mail só quando a central tiver template (hoje não há, escala §3.2 D5). Silêncio de 30 min por limiar via `IJobLease` com chave `ops-alert:<reason>`, nunca variável em memória. Streak de 5 min e limite de RAM lidos de `ops_metrics_samples`/Render API (`OPS_MEMORY_LIMIT_MB` como fallback). |
| MQ-25 | Leitura só por rota super admin (`/admin/ops/metrics`, 401 para não super admin como as demais rotas admin), que lê `ops_metrics_samples`/`worker_heartbeats`, nunca a Render ao vivo. Sem APM externo, sem `/metrics` público no `http`. Flag `OPS_METRICS_SAMPLER_ENABLED=false`; `RENDER_API_KEY` só na Render. |

**Teste independente:** sampler com clientes falsos (Render e PG) produz amostra, agrega, persiste a
cada 5 min e apaga > 7 dias; falha da Render ou do PG só loga e mantém o restante; alerta dispara uma
vez e respeita o silêncio de 30 min; rota recusa não super admin.

## Requisitos transversais

| ID | Critério |
|---|---|
| MQ-12 | Cada entrega deverá ter flags desligadas por padrão, gates de carga, rollout e rollback próprios. A poderá ser entregue sozinha; B/C não são pré-requisitos dela. D é ortogonal a A/B/C (carga de entrada no processo do socket × worker de 2 s). |
| MQ-13 | Testes co-localizados; SQL de claims exige integração Postgres local serial. Antes de merge: gates API/app, smoke controlado e `/caveman-review` sem bugs/risks abertos. |
| MQ-14 | Atualizar docs e versão do módulo alterado na implementação. Sem UI nova: i18n, tema, privacidade e persistência do painel permanecem compatíveis; erros públicos novos, se inevitáveis, exigem textos traduzidos nos dois lados. |
| MQ-15 | Durante o trabalho local, monitorar RAM; não iniciar carga com estimativa de uso ≥88%, suspender nossa carga antes de 90%. Nunca fechar processos do usuário automaticamente. Registrar método e limitações. |

## Fora do escopo

- Microserviços, migração para BullMQ de produto, novos papéis, Redis, adoção ou mudanças de lease.
- Busca retroativa no histórico: mensagens `append` não viram captura neste trabalho.
- Alterar planos, preço, assinatura, templates/e-mail do Hub ou dados de produção.
- Paralelizar capturas/IA, mudar envio/eco de mídia, impor prioridade comercial por plano.
- Tela de chat por plano, remoção de código do módulo chat, backfill de `lid`, mudança do Baileys fora do adapter.
- APM/agente externo, `/metrics` público, `track_io_timing`; SLA constante ou garantia de entrega exatamente uma vez.

## Rastreabilidade

| Requisitos | Tarefas | Estado |
|---|---|---|
| MQ-01..04 | T1–T4 | Implementado; gate produção pendente |
| MQ-05 | T1–T3, T5 | Implementado |
| MQ-06 | T1–T8, T12 | Implementado (regressão verde) |
| MQ-07..09 | T6–T8 | Implementado (flag 1); gate produção pendente |
| MQ-10..11 | T9–T11 | Implementado (flag false); gate produção pendente |
| MQ-12..15 | T4–T5, T8–T15 | Implementado |
| MQ-16..20 | T13–T15 | Implementado (flag false) |
| MQ-21..25 | T16–T18 | Implementado (flag false) |

Cobertura: 25 requisitos implementados e testados (unit + integração local); ativações dependem dos gates em validation.md.
