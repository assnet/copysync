# Filas de ofertas: independência e capacidade limitada

**Data:** 2026-11-08 · **Status:** plano revisável; implementação não iniciada.
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

## Requisitos transversais

| ID | Critério |
|---|---|
| MQ-12 | Cada entrega deverá ter flags desligadas por padrão, gates de carga, rollout e rollback próprios. A poderá ser entregue sozinha; B/C não são pré-requisitos dela. |
| MQ-13 | Testes co-localizados; SQL de claims exige integração Postgres local serial. Antes de merge: gates API/app, smoke controlado e `/caveman-review` sem bugs/risks abertos. |
| MQ-14 | Atualizar docs e versão do módulo alterado na implementação. Sem UI nova: i18n, tema, privacidade e persistência do painel permanecem compatíveis; erros públicos novos, se inevitáveis, exigem textos traduzidos nos dois lados. |
| MQ-15 | Durante o trabalho local, monitorar RAM; não iniciar carga com estimativa de uso ≥88%, suspender nossa carga antes de 90%. Nunca fechar processos do usuário automaticamente. Registrar método e limitações. |

## Fora do escopo

- Microserviços, migração para BullMQ de produto, novos papéis, Redis, adoção ou mudanças de lease.
- Busca retroativa no histórico: mensagens `append` não viram captura neste trabalho.
- Alterar planos, preço, assinatura, templates/e-mail do Hub ou dados de produção.
- Paralelizar capturas/IA, mudar envio/eco de mídia, impor prioridade comercial por plano.
- Dashboard novo, dependência de observabilidade, SLA constante ou garantia de entrega exatamente uma vez.

## Rastreabilidade

| Requisitos | Tarefas | Estado |
|---|---|---|
| MQ-01..04 | T1–T4 | Planejado |
| MQ-05 | T1–T3, T5 | Planejado |
| MQ-06 | T1–T8, T12 | Planejado |
| MQ-07..09 | T6–T8 | Condicional após A |
| MQ-10..11 | T9–T11 | Condicional após A |
| MQ-12..15 | T4–T5, T8–T12 | Planejado |

Cobertura: 15 requisitos mapeados; zero implementados/verificados como funcionalidade nesta etapa.
