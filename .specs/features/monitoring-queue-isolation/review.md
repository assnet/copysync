# Revisão do plano — /caveman-review

**Escopo:** documentos de planejamento; revisão de código executável ocorrerá na implementação.
**Critério de saída:** zero bugs/risks de desenho abertos; nits podem permanecer. Limitações
operacionais declaradas não equivalem a regressões resolvidas por testes ainda não executados.

## Achados da análise inicial incorporados

- `OfferDispatchWorker.ts:L57: risk: um único running sobre Promise.all mantém bloqueio entre rodadas. Usar dois slots independentes no timer existente.`
- `ProcessDueOfferDispatchesUseCase.ts:L74: risk: pré-claim de dez itens pode envelhecer além do stale de cinco minutos. No modo concorrente, claim só das vagas e refill limitado.`
- `server.ts:L458: risk: dois stops em série ampliam shutdown. Sinalizar ambos antes de aguardar sob teto compartilhado e reserva dos sockets.`
- `ProcessDueOfferDispatchesUseCase.ts:L191: risk: Promise.race não cancela sender. Preservar hold/sem retry; modo B mantém vaga até settle e possui recuperação de degradação.`
- `PrismaCapturedOfferRepository.ts:L45: risk: round-robin em Set local não cobre restart/multiworker. Persistir turno do tenant em claim transacional opcional.`
- `ProcessPendingCapturedOffersUseCase.ts:L55: risk: orçamento entre capturas não é prazo máximo do I/O. Não prometer SLA baseado em dez segundos.`
- `.specs/codebase/TESTING.md:L49: risk: documentação ignora integração local existente. Atualizar matriz e exigir SQL com PG local serial.`

## Rodadas independentes sobre os documentos

### Rodada 1

Dois revisores de leitura, aplicando a skill `caveman-review`, compararam os documentos com o
código. Achados e correções:

| Local da versão revisada | Achado | Correção incorporada |
|---|---|---|
| `spec.md:L40`, `design.md:L95` | risk: sender pendente após hold120s permite repetir sessão em outra vaga | Exclusões de claim incluem sessões das promises pendentes entre ticks; teste após120s; B só com um consumidor |
| `design.md:L95` | risk: limite de promises confundido com transferência de mídia | Contrato limitado a `IOfferMessageSender.send`; MEDIA mantém fila/limites atuais; regressões de MEDIA/texto/LINK_PREVIEW |
| `design.md:L110` | risk: orçamento de cinco claims subestima cenário com uma vaga presa | Até dez claims + uma busca vazia; carga mede cenário degradado |
| `spec.md:L51`, `design.md:L123` | risk: timestamps podem empatar e quebrar rodada estrita | Turno BigInt monotônico via sequência PG; rollback pode deixar lacunas; conjunto N estável |

### Rodada 2

- Revisor independente: **zero bugs/risks restantes**; nit de terminologia em `tasks.md:L126`
  corrigido para “vagas de chamadas pendentes ao sender”.
- Revisor de arquitetura: achados anteriores resolvidos; `spec.md:L51: risk: SKIP LOCKED pode
  pular tenant travado por billing. Condicionar limite N à ausência de contenção externa e testar
  atendimento após liberação.` Correção incorporada em spec/design/T10.

### Rodada 3

Revisor de arquitetura confirmou **zero bugs/risks de desenho remanescentes identificados**.
Restrições de locks, reservas entre rodadas e precisão do turno conferidas entre spec/design/tasks.
Todos os achados materiais corrigidos; nenhum nit pendente obrigatório. Três subagentes usados
no total (arquitetura, cobertura e revisão independente), no máximo dois ativos simultaneamente.

Nenhum teste de implementação foi executado; aprovação documental não substitui T5/T8/T11/T12.

## Rodada 4 — entregas D (gate do chat + `lid`) e E (métricas de recursos), 2026-11-09

Dois revisores independentes compararam D/E com o código. Achados materiais e correções:

| Local | Achado | Correção incorporada |
|---|---|---|
| `adapter:1286` | 🔴 `append` grava via `IngestHistorySyncUseCase` sem passar pelo bus; gate em listener não cobre | Gate dentro dos dois use cases de ingestão (MQ-16, T13) |
| `adapter:1331–1335`, `:1918` | 🔴 download roda antes do bus e 1:1 sempre baixa; gate em listener não impede | `IIncomingMediaPolicy` injetada no adapter (MQ-17, design D) |
| `RegisterCapturedMessageUseCase.ts:49`, `ProcessPendingCapturedOffersUseCase.ts:217–222` | 🔴 imagem da captura é o `mediaUrl` baixado pelo chat; design dizia o contrário | Política baixa só imagem de grupo monitorado sem chat; texto corrigido |
| `InternalEventBus.ts`, `SyncTenantEntitlementsUseCase` | 🔴 não há evento de invalidação de entitlements entre processos | Cache TTL 30–60 s lendo `tenant_entitlements` (MQ-20) |
| `adapter:601/:662/:1651` | 🟡 marca de eco só consumida no `append`; refs erradas (`:598`) | Consumir no `notify` antes do download/bus; refs corrigidas (MQ-18) |
| `InternalMessagingEvent.ts`, `extractParticipantJid` | 🟡 `authorLid` exige mudança de contrato não listada | Passo próprio em T14 (emissor+consumidor+CHANGELOG) |
| design E `SET LOCAL` | 🔴 fora de `$transaction` é autocommit | `$transaction([...])`, teste do timeout (MQ-22, T17) |
| MQ-24 e-mail | 🔴 `ICapacityAlertNotifier` sem implementação de produção; sem template na central | Só log até template existir |
| MQ-24 silêncio em memória | 🔴 contradiz regra de escala; cooldown atual é `IJobLease` | `IJobLease` `ops-alert:<reason>` |
| sampler em N workers | 🟡 amostragem duplicada | Dono único por `IJobLease` `ops-metrics-sampler` |
| ring buffer | 🟡 exceção não declarada | Declarada como cache de `ops_metrics_samples`, perda ≤ 5 min |
| streak CPU / limite RAM | 🟡 sem histórico nem limite configurado | Lidos de `ops_metrics_samples`/Render API, `OPS_MEMORY_LIMIT_MB` fallback |
| shutdown | 🟡 sem slot para o sampler | `stop()` antes de `heartbeat.stop()`, `AbortSignal.timeout` na Render |
| T16 migration | 🟡 colunas NOT NULL quebram deploy sobreposto; `$metrics` exige preview | Colunas nullable; pool removido, conexões via `pg_stat_activity` |
| Render API | ❓ não verificável offline | Doc oficial citada; confirmar antes de T17 |

Rodada 5 (convergência) pendente: um revisor sobre o texto corrigido; parar se só restarem nits.

### Rodada 5 — convergência D/E

Um revisor sobre o texto corrigido. Sem contradição nova de desenho; achados de localização incorporados:
`append` também baixa mídia (`adapter:1691/1704`) e Telegram baixa 1:1 (`:715/746`) → política nos dois
caminhos e nos dois adapters; 2ª composição em `localEngineContainer.ts:35` → factory único de gate+política;
`PrismaJobLease` só reaquire após vencer → TTL 45 s + `release()`; ordem real do shutdown (`server.ts:436–453`,
`:527`) e `Promise.all`; gate em `processChunk` (`execute` síncrono); reusar `IEntitlementReader.getBoolean`
em vez de porta nova. Confirmado OK: eco no `notify` não quebra dedup/status; `IJobLease` aceita chave
arbitrária. **Parada por convergência**: restam só nits. Nenhum teste executado; implementação não iniciada.

## Rodada 6 — revisão do código implementado (A–E), 2026-11-09

Três revisores (`/caveman-review`) sobre `acdbffe..HEAD`, um por grupo (A+B, D, C+E). Zero 🔴.

| Grupo | Achado | Decisão |
|---|---|---|
| D | 🟡 `append` baixava imagem de grupo monitorado sem consumidor | Corrigido: política recebe origem; `history` sem chat não baixa |
| D | 🟡 lookup de LID/autor de citação sem prazo no loop do notify (vale com flag false) | Corrigido: `withTimeout`, miss segue caminho atual |
| D | 🟡 falha de leitura do entitlement sem timeout nem cache | Corrigido: timeout ~1 s, fallback `true` cacheado 10 s |
| D | 🟡 marca de eco consumida no notify para todo tenant | Corrigido: notify só confere; consumo segue no append. Pular eco no notify vale também com flag false (download desperdiçado) |
| D | 🔵 presença async sem try/catch | Corrigido |
| E | 🟡 retenção DELETE sem LIMIT nem statement_timeout | Corrigido: lotes de 5.000 em transação com timeout |
| E | 🟡 tick > 45 s perde o lease com dono ativo | Corrigido: lease reconferido antes de persistir; tick com teto |
| E | 🟡 séries da Render descartadas em silêncio | Corrigido: log limitado com contagem |
| migr. | 🟡 ALTER sem `lock_timeout` | Revertido na rodada 7: falha por lock viraria P3009 e travaria o boot; tabelas pequenas (prod: chat_contacts 55 mil linhas/16 MB, tenants 7), espera curta é o menor risco |
| A/B | 🔵 log de erro inteiro, timer sem `unref`, item abortado ainda processado | Corrigidos |
| A | 🟡 modo legado não repassa sinal ao `stop()` | Mantido: flag false = comportamento de hoje (MQ-12) |
| B | 🟡 sem recuperação automática de sender eterno | Mantido: runbook manual de restart do design B; alerta a cada 60 s |
| B | 🟡 um `claimDue` por vaga (advisory lock por item) | Mantido: medir p95 do claim no gate de B antes de ativar |
| C | 🔵 tenant com captura travada fica no topo até liberar | Mantido: documentado em validation.md C |

### Rodada 7 — convergência

Um revisor sobre as correções: todas resolvem o achado sem bug novo, exceto dois pontos corrigidos:
`CachedChatEntitlementGate` em falha passa a usar o **último valor conhecido** do tenant (antes
`true`, que religava a ingestão de tenant sem chat com pool saturado); `SET lock_timeout` removido
das migrations (P3009). Restam só decisões "Mantido" da rodada 6. **Parada por convergência.**
