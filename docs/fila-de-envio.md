# Fila de envio por sessão (`send-queue`)

Status: **implementada (api 0.36.0 · app 0.41.0, 2026-10-27)**. Usada pelo
[`monitoramento-grupos.md`](monitoramento-grupos.md).

A fila é o banco: `offers` + `offer_dispatches`, drenada pelo `OfferDispatchWorker`. Navegador
fechado não interrompe nada. Esta camada acrescenta três coisas: **faixa por sessão**, **leitura da
fila** (qualquer aba ou navegador) e **origem/validade** da oferta.

## 1. Onde está

| Peça | Arquivo |
|---|---|
| Migration | `api/prisma/migrations/20261028010000_add_send_queue_lanes/` |
| Agenda que encosta no fim da faixa | `campaigns/domain/services/appendToLanes.ts` |
| Claim com série por sessão + `laneTails` | `campaigns/infrastructure/repositories/PrismaOfferDispatchRepository.ts` |
| Envio e retomada usando a faixa | `SendOfferUseCase.ts`, `OfferSendControlUseCases.ts` (`ResumeOfferUseCase`) |
| Validade no envio | `ProcessDueOfferDispatchesUseCase.ts` (`OFFER_EXPIRED`) |
| Leitura | `GetSendQueueUseCase.ts`, `PrismaSendQueueReader.ts`, `ISendQueueReader.ts` |
| Rota | `GET /api/campaigns/send-queue[?sessionId=]` (`sendQueue.routes.ts`) |
| Painel | `app/src/features/sendQueue/` (`SendQueuePanel`, `useSendQueue`, `laneCooldown`, `strings.ts`) |

## 2. Faixa por sessão

**Por que sessão e não tenant**: o limite real (cooldown, "digitando…", risco de banimento) é do
número de WhatsApp. Duas sessões do mesmo tenant enviam em paralelo; a mesma sessão, em série.

### 2.1 Schema

- `OfferDispatch.sessionId String?`: cópia de `conversation.sessionId`, gravada no
  `startSending` (sem join no claim). Backfill na própria migration; `null` só em envio antigo cuja
  conversa não tinha sessão (vira faixa própria).
- `OfferDispatch.gapSeconds Int @default(0)`: intervalo mínimo da configuração no momento do envio.
- Índices `(sessionId, status)` (claim) e `(tenantId, updatedAt)` (concluídos do dia).
- `Offer.origin` (`GENERATOR | MONITORING`, padrão `GENERATOR`) e `Offer.expiresAt` (validade).

Deploy com fila em andamento: `QUEUED` mantém o horário; `SENDING` sem `chatMessageId` volta para
`QUEUED` pelo `releaseStale` (5 min, `STALE_DISPATCH_MS`). Nada se perde. Envio travado de oferta
já parada (`CANCELLED`) fecha como `CANCELLED` em vez de voltar à fila. Envio travado segura a
faixa da sessão até o `releaseStale` (no máximo 5 min).

### 2.2 Garantia: o claim

`claimDue` (uma transação, serializada por `pg_advisory_xact_lock(hashtext('offer_dispatch_claim'))`):

1. por sessão, o candidato é o `QUEUED` vencido de menor `notBefore` de oferta `SENDING`
   (`DISTINCT ON`);
2. só entra se a sessão **não tem envio `SENDING`**, nem **`SENT` iniciado (`claimedAt`) há menos
   de `gapSeconds`** do candidato, nem **`FAILED/SEND_TIMEOUT` há menos de
   `max(gapSeconds, 120 s)`** (a mensagem pode ainda estar saindo: timeout 60 s + digitação), menos 5 s de tolerância (`LANE_GAP_TOLERANCE_SECONDS`: o claim
   acontece até um tick depois do `notBefore`, e sem folga a cadência da própria oferta escorregaria).

Resultado: no máximo um envio por sessão por tick, nunca dois em voo na mesma sessão, espaçamento
mínimo entre ofertas diferentes. O lock substitui o `SKIP LOCKED` (incompatível com `DISTINCT ON`) e
impede dois workers de abrirem a mesma faixa.

### 2.2.1 Sessão fora do ar na vez do envio

O envio falha com `SESSION_NOT_CONNECTED` **antes** de gravar ou mandar qualquer coisa (engine
ausente; socket fechado em `createOutboundMessageId`/`sendMediaMessage`). `ENGINE_NOT_READY` não
entra: é também o código genérico do tradutor de erro do envio de texto (pode ter saído). Nesse caso ele **volta para a fila**
(`deferForOfflineSession`): `QUEUED`, nova tentativa em 60 s (`OFFLINE_RETRY_MS`) e
`waitingSessionSince` com o início da espera. No claim, envio em espera **segura a sessão** (nenhum
outro dela sai antes da nova tentativa) e, quando vence, **sai primeiro**: a ordem da fila se mantém.
Fora do ar por mais de 6 h (`OFFLINE_MAX_WAIT_MS`): falham juntos (`SESSION_NOT_CONNECTED`) os
atrasados da sessão e o resto da mesma oferta, só de ofertas em envio (pausada não é tocada); nenhum
ganha outra janela de 6 h. Oferta parada enquanto o envio saía não volta para a fila. Oferta com validade sai `SKIPPED/OFFER_EXPIRED` se vencer
esperando. Erro no meio do envio (ex.: `RECOVERABLE_CONNECTION_ERROR`) não volta: a mensagem pode
ter saído. Envio legado sem sessão continua falhando como antes. Painel: "Aguardando a sessão".

Motivo: a sessão pode cair sem registro (o banco segue `CONNECTED`); antes, cada grupo da vez
virava "Falhou" e perdia a oferta.

### 2.3 Previsão: encostar no fim da faixa

Ao disparar (`SendOfferUseCase`) e ao retomar (`ResumeOfferUseCase`), a agenda da oferta é
calculada como antes (`scheduleDispatches`) e depois deslocada por `appendToLanes`: o menor
deslocamento que põe o primeiro envio de cada sessão pelo menos uma folga (sorteada no intervalo da
configuração) depois do fim da faixa. Ordem e espaçamento internos não mudam.

Fim da faixa (`laneTails`): maior `notBefore` aberto (`QUEUED`/`SENDING`) de ofertas `SENDING` que
**já começaram até o início desta** (`scheduledAt` nulo ou ≤ início). Oferta agendada para amanhã
não segura um envio de agora. Oferta pausada não conta; ao retomar, vai para o fim.

O enfileirar não usa lock: duas ofertas disparadas no mesmo instante podem prever horários que se
sobrepõem. O claim (2.2) garante o espaçamento real; só a previsão fica otimista.

### 2.4 Prioridade

FIFO por `notBefore`. Oferta manual não fura o que já está na fila. Se o produto pedir:
`Offer.priority` e `ORDER BY priority DESC, notBefore` no claim.

## 3. Leitura: `GET /campaigns/send-queue`

```json
{ "serverTime": "…",
  "sessions": [{
    "sessionId": "…", "name": "…", "status": "CONNECTED",
    "running": { "dispatchId", "offerId", "origin", "offerStatus", "title", "textPreview", "groupName", "status": "SENDING", "claimedAt", … } | null,
    "waiting": [ …mesmo formato, "status": "QUEUED", "offerStatus": "SENDING|PAUSED", "notBefore" ],
    "recent":  [ …concluídos hoje, mais recentes primeiro, até 20 por sessão ],
    "counts":  { "waiting", "paused", "sentToday", "failedToday", "skippedToday" } }] }
```

- Todas as consultas filtram `tenantId`. "Hoje" = meia-noite de `America/Sao_Paulo`.
- Listas lidas por sessão (100 abertos, 20 concluídos); contadores por `groupBy`, exatos. Uma
  sessão com fila longa não esconde as outras.
- Sessão do tenant sem nada aparece com listas vazias; o painel a esconde.
- Pausar/retomar/parar continuam em `POST /campaigns/offers/:id/{pause|resume|cancel}`.

## 4. Painel

- `SendQueuePanel` no fim do Gerador de ofertas, também com o assistente de configuração aberto
  (tenant sem gerador configurado ainda vê a fila). Por sessão: chips de contagem com tooltip, alerta
  de sessão desconectada, "Enviando agora", `CooldownBar` até o próximo (`laneCooldown`, relógio do
  servidor), abas "Aguardando" / "Concluídos hoje", origem de cada oferta.
- "Abrir oferta" carrega no gerador uma oferta disparada em outra aba e sobe a tela até ela (só
  origem `GENERATOR`; bloqueado com edição pendente ou assistente aberto). Próximo envio atrasado
  mais de 30 s mostra aviso em vez de "Enviando…" parado.
- Polling (`useSendQueue`): 5 s com algo na fila, 20 s vazia, parado com a aba oculta, atualiza ao
  voltar. WebSocket fica para quando houver evento por tenant fora do chat.
- Privacidade: recebe as flags da tela que o hospeda (gerador usa `offers.*`).
- Aba aberta por sessão em `usePersistedState('sendQueue.tabs')`. Dado da fila nunca é salvo.

## 5. Fase 2 (escala)

Com `PROCESS_ROLE=worker` e BullMQ (`arquitetura-escala.md` §3.3/3.6), a faixa vira fila BullMQ por
`sessionId` com `concurrency 1`; `offer_dispatches` continua a fonte de verdade e a leitura não muda.

## 6. O que não fazer

- Fila em memória ou por aba; estado operacional só no banco.
- Cooldown por oferta: é por sessão (`gapSeconds` + claim).
- Tirar o advisory lock do claim (abre a mesma faixa em dois workers).
- Criar envio sem `sessionId` (cai na faixa "legado", sem série).
- `Date.now()` no painel contra `notBefore`; sempre `serverNow()`/`serverToLocal()`.
- Testar SQL do claim num Postgres em fuso diferente de UTC: as colunas são `timestamp` sem fuso
  gravadas em UTC (a Render é UTC). Banco local de teste: `ALTER DATABASE … SET timezone='UTC'`.
