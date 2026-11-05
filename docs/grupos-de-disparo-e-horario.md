# Grupos de disparo e horário de postagem

Roadmap itens 5 (`campaigns/broadcast-groups`) e 6 (`campaigns/posting-schedule`) · api 0.61.0 · app 0.78.0.
Spec: `.specs/features/broadcast-schedule/`.

## Grupos de disparo

- **Sem tabela de catálogo.** Os destinos continuam em `offer_destinations` (gerador) e `broadcast_groups`
  (por monitoramento). O catálogo é a **união** das duas, lida por `IBroadcastGroupUsageReader`
  (`PrismaBroadcastGroupUsageReader`, `tenantId` em toda consulta, sessão apagada fora).
- **Limite** `broadcast_groups` / `telegram_broadcast_groups` = grupos **distintos** (sessão + JID) do tenant,
  por canal, somando gerador e todos os monitoramentos (`countDistinctBroadcastGroups`,
  `campaigns/domain/services/broadcastGroupUnion.ts`). Mesmo grupo nos dois usos conta 1. Salvar acima →
  `PLAN_LIMIT_REACHED`, nada muda. Conta o grupo **configurado**, mesmo que a sessão tenha saído dele (D4).
- `usage.<canal>.broadcastGroups` do `GET` do gerador e do monitoramento = união (os chips batem com o limite;
  tooltip "o limite soma gerador e monitoramento" com link para `/broadcast-groups`).
- O envio (`SendOfferUseCase`) só checa os próprios alvos: plano rebaixado não trava um uso por causa do outro.
- **Efeito no deploy**: tenant que já passa do limite pela soma fica impedido de salvar novos destinos até
  remover grupos (D5: só bloqueia o próximo save, sem banner).
- Rotas (`/api/campaigns/broadcast-groups`, `authHook` + `tenantHook`):
  - `GET /` → `{ items:[{ conversationId, sessionId, sessionName, channel, title, avatarUrl, usedBy[] }], limits, usage }`;
    `usedBy` = `generator` | `monitor:<sessionId>`. Sem texto de mensagem.
  - `DELETE /:conversationId` → tira o grupo de **todos** os usos do tenant numa transação
    (`RemoveBroadcastGroupUseCase`); idempotente; conversa de outro tenant = 404. Envios `QUEUED` já criados
    seguem as regras da fila.
- Painel `/broadcast-groups` (Afiliados → Grupos de disparo): `BroadcastGroupsTable` com chips `n / limite`,
  filtro canal + busca em `usePersistedState` (`tab`), remover com confirmação. Privacidade:
  `broadcastGroups.groupNames`, `.groupAvatars`, `.sessionName`. Textos em `features/broadcastGroups/strings.ts`.
- Catálogo **só lista e remove** (D1). Adicionar grupo "sem uso" exigiria tabela nova.

## Horário de postagem

- Regra pura `campaigns/domain/services/postingWindow.ts`: faixa em minutos 0..1440 + `weekdaysMask`
  (bit 0 = domingo; 127 = todos; 0 inválido), fuso `America/Sao_Paulo`. Faixa que cruza a meia-noite pertence
  ao **dia do início** (sexta 22–02 cobre sábado 01:00). Próxima abertura em até 7 dias.
  `automation/domain/services/operatingWindow.ts` delega a ela (mask padrão 127).
- Migration `20261104180000_add_posting_schedule_weekdays` (só `ADD COLUMN … DEFAULT`):
  `group_monitor_configs.weekdaysMask` (127); `offer_generator_configs.windowStartMinute` (0), `windowEndMinute`
  (1440), `weekdaysMask` (127). Padrão = comportamento anterior (dia inteiro, todos os dias).
- API: monitoramento e gerador aceitam `weekdays` (lista 0–6, ≥ 1) além da faixa; mask ↔ lista no mapper.
  Campo ausente (cliente antigo) mantém o salvo.
- **Claim** (`PrismaOfferDispatchRepository`, `docs/fila-de-envio.md` §2.6): monitoramento respeita o dia
  (hoje para o trecho após o início, ontem para o trecho após a meia-noite); oferta `GENERATOR` sem
  `scheduledAt` respeita a janela do `offer_generator_configs` do tenant. **`scheduledAt` explícito ignora a
  janela** (D3: o operador escolheu a hora).
- Previsão: `fitSlots` (`campaigns/domain/services/fitSlots.ts`) encaixa os horários na janela no
  enfileiramento do monitoramento, no disparo do gerador e na retomada (`OfferSendControlUseCases`), para a fila
  mostrar horário real. Disparo às 23:00 com janela 08–22 prevê 08:00 do dia seguinte.
- Painel: `PostingWindowField` (`app/src/components/`, slider + chips de dias, `value: { window, weekdaysMask }`)
  no monitoramento (`MonitoringSettingsForm`, rascunho v6) e no passo **Horário** do assistente do gerador
  (`ConfigScheduleStep`, rascunho v2). Rascunho com versão nova descarta o anterior.

## O que não fazer

- Criar tabela de catálogo ou contar o limite só dentro de um uso.
- Consultar a engine no save para filtrar grupo "morto" (D4).
- Várias faixas por dia ou fuso por tenant (fora do v1; ver spec D2).
- Fazer `scheduledAt` esperar a janela.
- Mudar o padrão das colunas (127 / 0–1440): ele é o que mantém o comportamento antigo.
- Enviar `weekdays` no PUT do monitoramento sem a coluna (`weekdaysMask`) no banco: T10 e T14 vão juntas.
