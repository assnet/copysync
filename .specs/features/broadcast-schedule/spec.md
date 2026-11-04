# Grupos de disparo + Horário de postagem — Spec

**Roadmap:** itens 5 (`campaigns/broadcast-groups`) e 6 (`campaigns/posting-schedule`) · **Marco:** M2, trilha P
(`docs/plano-lancamento-hub-copysync.md`) · **Status:** Draft (2026-11-04) · **Tasks:** `tasks.md`

## O que já existe (não duplicar)

| Peça | Onde | Observação |
| --- | --- | --- |
| Destinos do gerador | `OfferDestination` (tenant) via `PrismaOfferGeneratorConfigRepository.save` | limite `broadcast_groups`/`telegram_broadcast_groups` contado **só dentro do gerador** |
| Destinos do monitoramento | `BroadcastGroup` (por `GroupMonitorConfig`) | limite contado no tenant **só entre monitoramentos**, com filtro `live` |
| Janela de envio | `GroupMonitorConfig.windowStartMinute/EndMinute`, `automation/domain/services/operatingWindow.ts`, claim SQL em `PrismaOfferDispatchRepository` (§2.6 de `docs/fila-de-envio.md`) | uma faixa por dia, todos os dias, só monitoramento; gerador ignora |
| Agendamento pontual | `Offer.scheduledAt` + `campaigns/domain/offerSchedule.ts` | início único por oferta, teto 30 dias |
| Worker | `OfferDispatchWorker` sob `OFFER_DISPATCH_WORKER_ENABLED` | nenhum worker novo |
| Limites | `planPresets.ts`: WA 5/10/40, TG 0/10/40 (LITE/PRO/MAX) | chaves já estáveis |

**Lacunas:** (1) LITE consegue 5 grupos no gerador + 5 no monitoramento = 10 > plano; (2) não há tela única
dos grupos de disparo do cliente; (3) horário não tem dias da semana e não vale para o gerador.

## Alternativas avaliadas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Tabela nova de catálogo substituindo `OfferDestination` + `BroadcastGroup` | ❌ agora | migration + backfill + reescrita do worker/monitor; risco alto no M2 |
| Manter as duas tabelas; limite pela **união** + tela de catálogo (leitura + remover) | ✅ | sem migration no item 5; corrige o furo do limite; consumidores intocados |
| Só corrigir o limite | ❌ | não entrega o item 5 (tela) |
| Horário: tabela `posting_windows` com várias faixas por dia | ❌ agora | claim SQL vira N joins; adiar (D2) |
| Horário: `weekdaysMask` + faixa única, no monitoramento **e** no gerador | ✅ | migration aditiva com padrão = comportamento atual; reusa `operatingWindow` e o claim |

## Requisitos

### Grupos de disparo (BG)

- **BG-01** Limite `broadcast_groups`/`telegram_broadcast_groups` = grupos **distintos** (sessão + JID) do tenant somando gerador e
  todos os monitoramentos, por canal. Salvar gerador ou destino do monitoramento acima disso → `PLAN_LIMIT_REACHED` (nada muda).
- **BG-02** Envio do gerador (`SendOfferUseCase`) mantém a checagem atual (só os próprios alvos): plano rebaixado não trava o
  monitoramento por causa do gerador nem o contrário.
- **BG-03** `GET` das duas configurações devolve `usage.<canal>.broadcastGroups` = união (chips do painel batem com o limite).
- **BG-04** `GET /campaigns/broadcast-groups`: catálogo do tenant — grupo, sessão, canal, `usedBy` (`generator`, `monitor:<sessionId>`),
  sem texto de mensagem; filtro `tenantId` em toda consulta.
- **BG-05** `DELETE /campaigns/broadcast-groups/:conversationId`: tira o grupo de **todos** os usos do tenant (gerador e monitoramentos);
  envios `QUEUED` já criados seguem as regras atuais da fila.
- **BG-06** Painel `/broadcast-groups`: lista com uso por canal (`n / limite`), filtro canal + busca em `usePersistedState` (`tab`),
  remover com confirmação, `Blurred` em nome/foto do grupo e sessão (flags novas), i18n em `strings.ts`, tooltip, claro/escuro/sistema.
- **BG-07** Item no menu de produtos (`buildNavigation`) com rótulo em `strings.ts`.

### Horário de postagem (PS)

- **PS-01** Regra pura `postingWindow`: faixa 0..1440 + `weekdaysMask` (bit 0 = domingo; 127 = todos); fuso `America/Sao_Paulo`;
  faixa que cruza a meia-noite pertence ao **dia do início**; próxima abertura em até 7 dias; mask 0 é inválido.
- **PS-02** Migration aditiva `add-posting-schedule-weekdays`: `group_monitor_configs.weekdaysMask` (127) e
  `offer_generator_configs.windowStartMinute` (0), `windowEndMinute` (1440), `weekdaysMask` (127). Padrão = comportamento de hoje.
- **PS-03** Claim do worker: monitoramento respeita dia da semana; oferta `GENERATOR` respeita a janela do gerador do tenant,
  **exceto** com `scheduledAt` explícito (D3). Sem efeito com dia inteiro + todos os dias.
- **PS-04** Monitoramento: API aceita `weekdays` (lista 0–6) além da faixa; captura fora do horário (`outside_window`) e `fitSlot` usam o dia.
- **PS-05** Gerador: config aceita faixa + dias; ao disparar sem `scheduledAt`, horários previstos encaixam na janela (mesmo `fitSlots`
  do monitoramento) para a fila mostrar horário real.
- **PS-06** Painel: campo único `PostingWindowField` (slider existente + chips de dias), usado no monitoramento e num passo novo do
  assistente do gerador; rascunho em `usePersistedState`; i18n; temas; tooltip explicando "fora do horário a oferta espera".

### Comuns

- **CM-01** Doc `docs/grupos-de-disparo-e-horario.md` (o que fazer/não fazer), link no AGENTS.md, status no roadmap,
  `fila-de-envio.md` §2.6 e `monitoramento-grupos.md` §2.2 atualizados; CHANGELOG + versão api/app (minor).
- **CM-02** Nenhum boot escreve em massa; nenhuma flag nova; nenhum estado em memória (`docs/arquitetura-escala.md`).

## Fora de escopo

Várias faixas por dia; fuso por tenant; disparo em massa (item 10); menção a todos (item 14); enforcement de downgrade em lote (trilha B).

## Decisões para o dono

- **D1** Catálogo só lista e remove (recomendado) ou também adiciona grupo "sem uso"? Adicionar exige tabela nova (alternativa rejeitada).
- **D2** Uma faixa por dia + dias da semana no v1 (recomendado); várias faixas depois?
- **D3** Oferta do gerador com `scheduledAt` explícito ignora a janela (recomendado: o operador escolheu a hora) ou espera a janela?
- **D4** União conta grupo **configurado** mesmo que a sessão tenha saído dele (recomendado; a tela remove) ou mantém o filtro `live`
  do monitoramento (exige consulta à engine no save do gerador)?
- **D5** Tenant que hoje já passa do limite pela soma: só bloqueia o próximo save (recomendado) ou avisa no painel com banner?

## Riscos

- **R1** Claim SQL sob `pg_advisory_xact_lock`: cláusula nova precisa de teste int com Postgres descartável; nunca `api/.env`.
- **R2** Dia da semana em SQL: `EXTRACT(DOW ...)` no fuso; virada de meia-noite exige "hoje" e "ontem" — bug clássico; cobrir 23:59/00:00.
- **R3** D4 muda a conta do monitoramento: tenant com grupo "morto" pode bater no limite após o deploy (comunicar/ver D5).
- **R4** Janela do gerador encaixada + `expiresAt`/cupom: oferta pode vencer antes de abrir (já tratado como `expired` no enqueue; manter).
- **R5** Arquivos quentes (`OfferGeneratorConfigUseCases.ts`, `PrismaOfferDispatchRepository.ts`) disputados com E3/E5: rebase curto.
