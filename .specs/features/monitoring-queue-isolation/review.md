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
