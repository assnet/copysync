# Monitoramento de grupos (`group-monitoring`)

Item 4 do [`produto-roadmap.md`](produto-roadmap.md). Escuta grupos de concorrentes, captura a
oferta, troca o link pelo link de afiliado **do tenant** e reposta nos grupos de disparo do tenant,
respeitando horário de operação, intervalo entre envios e validade da oferta.

Status: **implementado (api 0.37.0 · app 0.42.0, 2026-10-27)**. Depende da
[fila de envio por sessão](fila-de-envio.md).

Termos: **sessão** (nunca instância), **grupo monitorado** (origem), **grupo de disparo**
(destino), **oferta capturada**.

## 1. Onde está

| Peça | Arquivo |
|---|---|
| Migration | `api/prisma/migrations/20261028020000_create_group_monitoring/` |
| Regras puras | `automation/domain/services/` (`offerMessageText`, `operatingWindow`, `monitorSettings`) |
| Configuração | `GroupMonitorConfigUseCases.ts` (ler, salvar regras, grupos monitorados, grupos de disparo) |
| Captura (listener) | `RegisterCapturedMessageUseCase.ts` + `GroupMonitoringMessageListener.ts` |
| Processamento (worker) | `ProcessPendingCapturedOffersUseCase.ts` |
| Link do tenant | `campaigns/application/use-cases/BuildTenantAffiliateLinkUseCase.ts` (núcleo em `application/services/TenantAffiliateLinkComposer.ts`, compartilhado com o gerador) |
| Dados do produto e foto | `campaigns/application/use-cases/ResolveProductDataUseCase.ts` (o mesmo do gerador); vitrine social ML em `parseMercadoLivreSocialPage` |
| Texto (modelo / IA) | `campaigns/application/services/OfferTextComposer.ts` via `IMonitorTextComposer` (adapters em `CampaignsMonitorAdapters.ts`) |
| Entrada na fila | `campaigns/application/use-cases/EnqueueOfferUseCase.ts` |
| Rotas | `/api/automation/group-monitoring/*` (`groupMonitoring.routes.ts`) |
| Painel | `app/src/pages/monitoring/`, `app/src/features/monitoring/` |

Tabelas: `group_monitor_configs` (uma por sessão), `monitored_groups`, `broadcast_groups`,
`captured_offers`.

## 2. Fluxo

1. **Captura** (listener do `MESSAGE_RECEIVED`, só com `GROUP_MONITORING_ENABLED`): mensagem de grupo, não minha, com
   link no texto → busca o grupo monitorado ativo por `(tenantId, sessionId, groupJid)` → confere
   palavras-chave (vazio = tudo; sem acento e sem caixa) → grava `captured_offers` `PENDING`.
   Texto sem link sai antes de qualquer consulta. Repetida (mesmo id externo) é ignorada pela
   unique. Mensagem que não bate com as palavras-chave não é gravada.
2. **Foto**: só imagem JPEG/PNG/WebP (`image/jpg` normalizado) do **media store**. O `mediaUrl`
   do evento só existe com `autoDownloadMedia` ligado na conversa; salvar grupos monitorados liga
   isso (remover o grupo não desliga). Vídeo, GIF, link com prévia ou foto sem download → foto do
   produto (em qualquer modo de texto, inclusive `ORIGINAL`); sem ela, oferta só com texto. Foto
   que falhou fica marcada `imageUnavailable`. Grupos de Shopee postam quase sempre texto com
   prévia do link (sem imagem anexada): sem esse fallback a oferta sai sem foto.
   **Telegram**: a engine baixa a foto (`msgType: 'IMAGE'`, `image/jpeg`) sob a mesma regra
   `autoDownloadMedia`, e o id externo é `<peerId>_<msgId>` (único por sessão; ver `sessoes-telegram.md` §5).
3. **Processamento** (no tick do `OfferDispatchWorker`, flag `GROUP_MONITORING_ENABLED`): uma
   captura por vez, até 3 por tick e 10 s de orçamento; `PROCESSING` parado há 5 min é
   reivindicado de novo. Para cada captura:
   - monitoramento desligado → `SKIPPED/MONITOR_DISABLED`; sem grupo de disparo →
     `NO_BROADCAST_GROUPS`; plano rebaixado → envia só até o limite atual;
   - cada link do texto (com protocolo, ou qualquer `dominio.tld/caminho` sem protocolo, inteiro,
     com subdomínio: `www.amazon…`, `bit.ly/…`) passa pelo `BuildTenantAffiliateLinkUseCase`: link
     de produto → link do tenant; qualquer outro (convite de grupo, encurtador de terceiro, outro
     site) → **removido**, e a linha que só tinha links removidos sai inteira; mais de 8 links =
     catálogo, não oferta; mais de 25 s resolvendo links da mesma captura → `FAILED/LINK_RESOLVE_FAILED`
     (recuperável), para não segurar o worker de envio;
   - **rede de segurança**: depois da troca, se sobrar no texto qualquer link que não seja do tenant,
     a captura vira `FAILED/LINK_RESOLVE_FAILED` e nada vai para a fila;
   - sem credencial do marketplace → `SKIPPED/CREDENTIAL_MISSING`; **loja recusou a credencial** (401/403 no uso,
     ou já recusada antes) → `SKIPPED/CREDENTIAL_REJECTED` **sem chamar a loja** (loja pausada até o usuário salvar
     chave/sessão nova; `AffiliateCredential.rejectedAt`, ver `integracoes-credenciais-afiliado.md`); rate limit e API
     fora não pausam; erro da API →
     `FAILED/LINK_RESOLVE_FAILED`; nenhum link de produto → `UNSUPPORTED_MARKETPLACE`;
   - cupom detectado no texto (`detectCoupon`) → validade menor;
   - início = captura + atraso, empurrado para o próximo início da janela; a validade conta desse
     início **calculado da captura** (processamento atrasado não a renova; o envio em si começa de
     agora); se a fila da sessão empurrar o 1º envio para depois da validade → `SKIPPED/EXPIRED`
     (oferta/cupom vencido não é distribuído);
   - entra na fila de envio da sessão (`EnqueueOfferUseCase`, origem `MONITORING`, `expiresAt`,
     `sourceKey = captured:<id>` único: captura reprocessada depois de uma queda reaproveita a
     oferta em vez de postar duas vezes; se a queda foi antes de enfileirar, a oferta ficou DRAFT e
     é enfileirada no reprocessamento);
     se a fila empurrar o 1º envio para depois da validade → `EXPIRED` sem criar oferta;
   - sucesso → `QUEUED` com `offerId` e `startsAt`. Erro inesperado → `FAILED/INTERNAL_ERROR`.
4. **Envio**: worker da fila (digitando…, marcar todos, intervalo, série por sessão). Envio de
   oferta vencida sai `SKIPPED/OFFER_EXPIRED`. Pausar/retomar/parar pela fila.

### 2.1 Link do tenant (`BuildTenantAffiliateLinkUseCase`)

A URL de origem é reconstruída na forma canônica **sem query** antes de receber a marcação do
tenant. Nada da origem (`tag`, `matt_word`, `matt_tool`, `af_*`, `utm_*`…) sobrevive.

| Marketplace | Canônica | Link do tenant |
|---|---|---|
| Amazon | `https://www.amazon.com.br/dp/<ASIN>` | `?tag=<ID de rastreamento do tenant>` |
| Shopee | `https://shopee.com.br/product/<shop>/<item>` | `generateShortLink` com AppID/secret do tenant |
| Mercado Livre | `/p/MLB…` ou `produto.mercadolivre.com.br/MLB-…` | `createAffiliateLinks` com a sessão (cookies) e etiqueta do tenant |

Mercado Livre "social" (vitrine `meli.la` → `/social/<etiqueta>?…&ref=…`): o produto vem do 1º card da
página (com o `ref` da query a ML põe o produto do link em primeiro). Dois formatos de card
(`parseMercadoLivreSocialPage`, `productRefCatalog`): `metadata.product_id` preenchido = id de **catálogo**,
URL enviada ao `createLink` é `/p/<product_id>` (`produto…/MLB-<product_id>` não existe, ML 100);
`product_id` vazio = anúncio fora de catálogo, id em `metadata.id`, URL `produto.mercadolivre.com.br/MLB-<id>`.
Até 2026-11-02 só o 1º formato era lido: todo `meli.la` de item virava "Loja não suportada" (226 capturas
em 14 dias). Título, preços e foto do 1º card seguem junto com o link (`TenantLinkResult.ok.product`) e o
processador usa isso antes de reler a página do produto: `/p/MLB…` e `produto…/MLB-…` caem no captcha do ML
para o servidor em ~90% dos casos (14 dias: 57 ofertas ML sem foto na mensagem, só 5 com foto do produto), e a
vitrine já tinha os dados. Vale para a foto em modo original e para o texto em modelo/IA. A vitrine é pública e é lida **sem** cookie (com cookie do servidor a ML manda para o captcha). Rede só dentro da allowlist
(`isSupportedProductUrl`, expansor e leitor de página). Aqui o link é sempre gerado.

Núcleo comum (api 0.81.0): o switch por marketplace saiu do builder para
`campaigns/application/services/TenantAffiliateLinkComposer.ts`, o mesmo que gerador, Página de Ofertas e Story usam
via `ResolveAffiliateProductUseCase` (extração sem mudar nenhum resultado do monitoramento, TLINK-23). O builder
continua dono de expandir, do gate de plano, do `resolveState` e de `markRejected` (pausa a loja); o composer não faz
nada disso. A allowlist do link devolvido para Shopee e ML é aplicada só no Resolve. Não mexer no composer sem rodar
os testes do builder.

### 2.1.1 Texto da oferta: original, modelo ou IA (api 0.41.0)

Config por sessão: `textMode` (`ORIGINAL` padrão | `TEMPLATE` | `AI`), `audience` (públicos do gerador;
`STANDARD` = modelo) e `enrichLinkOnly` (padrão `false`; **só PRO/MAX**, entitlement `enrich_link_only_enabled`:
só `true` libera. Salvar ligado sem o plano → `PLAN_FEATURE_UNAVAILABLE`; plano rebaixado com a opção salva →
o processamento trata como desligada; GET devolve `limits.enrichLinkOnlyEnabled` e o painel trava o switch). Depois do link do tenant e antes de enfileirar
(`buildMonitorText`):

1. `ORIGINAL` com texto além de links → texto do grupo com links trocados (como sempre), `textSource = ORIGINAL`.
2. `TEMPLATE`/`AI`, ou captura **só com link(s)** com `enrichLinkOnly` (`hasTextBeyondLinks` = false):
   lê o produto por `IMonitorProductReader` (`ResolveProductDataUseCase`: Shopee pela API com credencial;
   ML vitrine social pelo 1º `polycard` da página lida **sem cookie**, `product_id` é catálogo `/p/`;
   Amazon pela página) e compõe por `IMonitorTextComposer` (`OfferTextComposer`: `STANDARD` = modelo fixo,
   outro público = IA com fallback para o modelo). A IA só recebe JSON de dados, nunca o texto do
   concorrente. `textSource = AI` só quando a IA respondeu; `aiErrorCode` guarda o `AI_*` do fallback.
3. Degradação: sem dados do produto → texto original (captura segue `QUEUED`, log
   `captured offer product data unavailable`); texto composto com link que não é do tenant → original.
4. Foto: a da mensagem; sem ela, a do produto via `IMonitorImageStore` (também no `ORIGINAL`, só a foto, `productImageOnly`) (fetcher + media store do gerador,
   allowlist `mlstatic.com`/`susercontent.com`/`media-amazon.com`).

Entitlement de IA: o mesmo do gerador (`ai_rewrite_enabled`). **Decisão 2026-11-10: só PRO/MAX** (LITE `false`
explícito; ausente = liberado). Save com `textMode` AI no LITE grava `TEMPLATE`/`STANDARD` sem recusar; captura de
config AI salva no LITE é composta como Modelo (`textSource` TEMPLATE, sem `aiErrorCode`); GET devolve
`limits.aiRewriteEnabled` e o painel trava o card "Reescrita com IA" com selos PRO MAX. Limite diário de IA: o mesmo
`ai_usage_logs`, purpose `offer.text`.

### 2.2 Janela de operação

Minutos do dia em `America/Sao_Paulo`, 0..1440. **Padrão 06:00–18:00** (`360–1080`). `0–1440` = sem
restrição. `fim < início` = cruza a
meia-noite (`22:00 → 06:00`); `1440` como início equivale a 00:00 do dia seguinte.

A janela vale para **todos os envios** (api 0.44.0): o claim do worker não reivindica envio de
oferta do monitoramento fora da janela da sessão (minuto do dia em São Paulo, calculado em SQL),
não importa quando foi agendado nem se a configuração mudou depois. Às 20:00 o envio para e os
que faltam saem a partir das 06:00; o que vencer esperando sai `SKIPPED/OFFER_EXPIRED`. O
agendamento também encaixa cada horário na janela (`fitSlot` no `EnqueueOfferUseCase`), para a fila
mostrar horários reais.

**Dias da semana** (api 0.61.0): `weekdays` (lista 0–6, ≥ 1; coluna `weekdaysMask`, padrão 127 = todos).
Faixa que cruza a meia-noite pertence ao dia do início. Dia fora da lista: claim não reivindica, captura
fora do horário (`outside_window`) e `fitSlot` pulam para a próxima abertura. O gerador tem horário
próprio (`offer_generator_configs`). Ver [`grupos-de-disparo-e-horario.md`](grupos-de-disparo-e-horario.md).

**Capturar fora do horário** (`captureOutsideWindow`, padrão ligado; **só MAX**, entitlement
`capture_outside_window_enabled`: sem o plano o save grava `false` sem recusar — o padrão do banco é ligado e
cliente antigo reenvia o salvo — e `RegisterCapturedMessageUseCase` consulta o entitlement só quando a mensagem cai
fora da janela; o painel trava o switch e mostra o selo MAX): fora da janela a captura
continua e as ofertas acumulam na fila, saindo quando ela abrir. **A validade conta do início
previsto a partir da captura** (`captureExpiresAt(janela(captura + atraso))`, independente de quando
o processamento rodou): capturado às 19:00 com janela até 18:00 e
validade de 180 min, vale das 06:00 às 09:00 do dia seguinte; se contasse da captura, nunca sairia.
Dentro da janela, início ≈ captura (+ atraso configurado).
Desligado, mensagem fora da janela não é capturada nem entra na fila (`outside_window` no
listener, logado sem texto, sem linha no banco). Sem efeito com janela de dia inteiro. No
`PUT /config` o campo é opcional: ausente (cliente anterior a app 0.50.0) mantém o valor salvo.

## 3. Regras e limites

- Faixas: intervalo 0–3600 s (min ≤ max; 0 = sem espera entre envios; **padrão 0–0**; padrões novos (2026-11-09):
  "digitando…" ligado 3 s, validade 24 h com e sem cupom, prévia do link, montar só com link desligado),
  atraso 0–7200 s, validade 15–1440 min, validade com
  cupom ≤ validade sem cupom, "digitando…" 1–30 s. 422 `GROUP_MONITOR_INVALID_INPUT` com `field`.
- Plano, **por canal** (`tenants/domain/channelLimits.ts`): canal do grupo = engine da sessão dona
  (monitorado: sessão do monitor; disparo: `BroadcastGroup.sessionId`). WhatsApp = `monitored_groups` /
  `broadcast_groups`; Telegram = `telegram_monitored_groups` / `telegram_broadcast_groups`. Cada canal soma
  **todas as sessões do tenant** daquele canal e só é checado se a lista pedida tem grupo nele
  (`PLAN_LIMIT_REACHED` 403, `meta.key` = chave do canal). O GET expõe `channel` (canal da sessão do monitor),
  `limits.whatsapp|telegram.{monitoredGroups,broadcastGroups}` e `usage.whatsapp|telegram.{…}`;
  `limits.monitoredGroups`/`broadcastGroups` e `usage.*` na raiz = WhatsApp (legado). No processamento, plano
  rebaixado corta **por canal** na ordem da lista (`sliceByChannel`); `mention_all_enabled=false` bloqueia "marcar todos"
  (`PLAN_FEATURE_UNAVAILABLE`) e o worker envia sem marcar.
- O mesmo grupo não pode ser monitorado e de disparo no tenant (409
  `GROUP_MONITOR_GROUP_CONFLICT`): a oferta postada voltaria como captura.
- Só grupo de que a sessão participa (mesma regra do gerador); a conversa do chat é criada se faltar.
  `ensureGroup(…, purpose)`: monitorado = `'monitor'` (aceita canal do Telegram só de leitura, `canPost: false`);
  disparo = `'send'` (422 `GROUP_NOT_POSTABLE`, também WhatsApp só-admins sem a sessão ser admin). O seletor de
  disparo esconde `canPost === false` (switch "ocultar", padrão ligado).
- `broadcastGroups[]` do GET/PUT trazem `canPost: boolean | null` e `postBlockedReason` (`ADMINS_ONLY` |
  `CHANNEL_READONLY` | null), pela lista ao vivo das sessões donas (`IMonitorGroupDirectory.listParticipating` +
  `loadLiveGroups`, 4 s por sessão). Sessão fora/erro/prazo → `null` (desconhecido); a leitura nunca falha por isso.
- **Sessão cruzada** (api 0.42.0): grupo de disparo pode ser de **outra sessão do tenant**
  (`groups[].sessionId` no `PUT /config/broadcast-groups`). `cross_session_dispatch` (MAX; ausente =
  bloqueado, 403 `PLAN_FEATURE_UNAVAILABLE`) só é exigido quando monitor + destinos usam **2+ sessões do
  mesmo canal** (`requiresCrossSession`); WhatsApp → Telegram (ou o inverso) sempre pode. A sessão de destino tem de existir
  no tenant (404). O limite `broadcast_groups` conta grupos distintos (sessão + JID) do tenant somando todos os monitoramentos
  **e o gerador** (api 0.61.0, `grupos-de-disparo-e-horario.md`), não pela sessão dona do grupo. O mesmo grupo (sessão + JID) não pode ser destino de dois monitoramentos (409
  `GROUP_MONITOR_BROADCAST_TAKEN`, meta `groupJid`/`sessionId`/`monitorSessionId`; api 0.49.0) e o mesmo
  JID não entra duas vezes na lista por sessões diferentes (422 `GROUP_MONITOR_DUPLICATE_GROUP`: a oferta
  sairia duas vezes no grupo). O GET devolve `takenBroadcastGroups` (destinos dos monitoramentos das outras
  sessões) para o seletor bloquear antes de salvar. No envio,
  cada destino entra na faixa da **sua** sessão (`EnqueueOfferUseCase` multi-sessão); plano rebaixado
  depois de salvar → uma sessão por canal (`keepOneSessionPerChannel`: a do monitor no canal dela; nos outros,
  a 1ª da lista). Chaves de entitlement centralizadas em
  `tenants/domain/entitlementKeys.ts`; presets por plano em `tenants/domain/planPresets.ts` (seed).
  **Liberar manualmente** (conta interna/teste, sem plano MAX): upsert em `tenant_entitlements`
  `(tenantId, 'cross_session_dispatch', 'true'::jsonb)` com `ON CONFLICT ("tenantId", key)`, em transação,
  por usuário com permissão de escrita (nunca o read-only do AGENTS.md). Vale para o **tenant** inteiro,
  não para o usuário; o super admin é membro de todos os tenants, então filtrar por e-mail da equipe.
  O próximo evento de plano do hub (`SyncTenantEntitlementsUseCase`) sobrescreve com o preset do plano.
- Tentar de novo (`POST /captured/:id/retry`): só `SKIPPED`/`FAILED` com motivo recuperável
  (`CREDENTIAL_MISSING`, `CREDENTIAL_REJECTED`, `LINK_RESOLVE_FAILED`, `NO_BROADCAST_GROUPS`, `MONITOR_DISABLED`,
  `INTERNAL_ERROR`). A validade continua contando da captura original.
- Aviso de credencial (`credentialAlerts`, só no `GET /config`): por loja, `REJECTED` (`rejectedAt`) ou `MISSING`
  (credencial não utilizável + captura `CREDENTIAL_MISSING` nos últimos 7 dias). Um por loja; recusada prevalece.
  Save* não devolvem o campo; o painel mantém o anterior até o próximo load.

Imagem da captura: vem do download feito no adapter. Com `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED`
e tenant sem `chat_enabled`, só imagem de grupo monitorado é baixada (`docs/chat-ingestao-por-entitlement.md`).

### 3.1 Seleção justa de capturas entre tenants (`MONITORING_FAIR_CLAIM_ENABLED`)

Padrão `false`: `claimPending` = FIFO global por `capturedAt` (tenant com backlog grande atrasa os
outros). `true` (`PrismaCapturedOfferRepository`, injetado em `automationContainer.ts`): um statement
numa transação curta (`lock_timeout` 200 ms, `statement_timeout` 2 s, sem I/O) escolhe o tenant elegível
de menor `tenants.monitoringClaimTurn` (null primeiro, `id` desempata; `FOR NO KEY UPDATE SKIP LOCKED`),
pega a captura mais antiga dele (`capturedAt, id`, SKIP LOCKED), marca PROCESSING e grava o turno com
`nextval('monitoring_claim_turn_seq')`. Devolve **no máximo 1 item** qualquer que seja o `limit`.
Turno só avança se a captura foi obtida; erro reverte as duas linhas (lacunas na sequência não importam).
Tenant travado pelo billing é pulado nesta chamada (não espera) e volta depois. Garantia: com N tenants
continuamente elegíveis, um worker e sem lock externo, todos são atendidos nas primeiras N seleções.
Não promete ordem de conclusão, fairness do envio nem SLA. Migration `20261109130000_add_monitoring_claim_turn`
(aditiva, sem backfill). Evidência: `.specs/features/monitoring-queue-isolation/validation.md`, seção C.

Não fazer: ligar antes da migration; misturar workers em modos diferentes; round-robin em memória;
expor o turno em DTO/painel; usar `Tenant.updatedAt` como turno; rede ou I/O dentro da transação;
`UPDATE` de backfill em produção. Rollback = flag `false` + restart (coluna/sequência ficam).

## 4. Rotas (`/api/automation/group-monitoring`)

| Método | Rota | Uso |
|---|---|---|
| GET | `/config?sessionId` | regras, grupos (nome/foto da conversa), limites e uso no tenant |
| PUT | `/config` | salva as regras da sessão |
| PUT | `/config/monitored-groups` | substitui `{ groupJid, keywords }[]` |
| PUT | `/config/broadcast-groups` | substitui `{ groupJid, sessionId? }[]` (ordem = envio; `sessionId` ausente = sessão do monitor, outra exige `cross_session_dispatch`) |
| GET | `/captured?sessionId&cursor` | capturas, mais recentes primeiro, 20 por página (cursor assinado) |
| POST | `/captured/:id/retry` | volta para `PENDING` |

## 5. Painel

Redesenho app 0.54.0 (conceito "radar": fluxo origem → destino). Estilo em
`features/monitoring/monitoringStyle.ts` (tons, `focusRingSx`, `REDUCED_MOTION`, pílulas de vidro) e
`MonitorCard.tsx`; cor só do tema.

**Canais (WhatsApp × Telegram)** — limites por canal em `features/monitoring/utils/channelLimits.ts`
(funções puras: `channelLimit`/`channelUsage` leem `limits[canal]`/`usage[canal]`, raiz = WhatsApp só
como fallback; `channelCaps` = limite do canal − uso das outras sessões; `planLimitHit`/`upsellKindOf`
traduzem `PLAN_LIMIT_REACHED` `meta.key` → texto por canal + `PlanLimitBanner`). Canal do grupo = canal
da sessão dona (`config.channel` para o monitor). Cards mostram uma pílula por canal das sessões do
tenant (`ChannelUsageChips`); o seletor bloqueia por canal. Sem `crossSessionDispatch`, o seletor de
disparo lista a sessão atual + sessões conectadas de outro canal, e trava a 2ª sessão do mesmo canal.
Logo do canal só via `ChannelLogo` (`features/sessions/components/`). Monitor ou destino no Telegram
com "Marcar todos" ligado → nota discreta (no Telegram não existe). Não somar canais num contador só.

- **Hero** (`MonitoringHero.tsx`): status (Ativo/Pausado, ponto pulsando só sem reduced-motion), seletor
  de sessão e etapas sessão → monitorados → disparo → lojas, cada uma com ação. Estado vazio explica o recurso.
  "Conectar nova sessão" leva a `/settings/sessions?create=1&returnTo=/monitoring`; volta com
  `/monitoring?sessionId=<nova>` (`safeReturnPath` só aceita caminho interno).
- **`CredentialAlerts`**: linha compacta por loja (sem credencial = aviso; recusada = erro, com data) +
  "Configurar credencial" → `/settings/affiliate-credentials?returnTo=/monitoring`.
- **Grupos** (`MonitoredGroupsCard`, `BroadcastGroupsCard`): contador "n/max no plano"; nome resolvido por
  jid; avatar com foto ou ícone (sem iniciais), sempre com blur. Remover tem "Desfazer" via `reinsertGroup`.
  Com `limits.crossSessionDispatch` o disparo lista grupos de todas as sessões ("Envia por <sessão>", com a
  foto da sessão em 16 px no chip; app 0.56.1). Foto de sessão sempre por `SessionAvatar` (ícone de aparelho
  sem foto, blur `monitoring.sessionAvatar`), no card e no seletor;
  sem a feature, aviso "exclusivo do plano MAX" → `/plans`.
- **Seletor** (`GroupPickerDialog`): disponíveis × selecionados em 2 colunas (md+) ou abas (xs); grupo usado
  no outro papel aparece bloqueado com o motivo visível; palavras-chave por grupo monitorado.
  Com sessão cruzada (disparo): cada grupo mostra a sessão dona com a foto dela em 16 px (altura do texto,
  ícone de aparelho sem foto, blur `monitoring.sessionAvatar`) e há chips de filtro "Todas" + uma por sessão
  conectada (filtra só os disponíveis; sessão que desconecta volta para "Todas").
  Disparo (app 0.56.0): setas ↑↓ por selecionado definem a ordem de envio já no seletor; grupo de
  `takenBroadcastGroups` ("Já recebe as ofertas do monitoramento de <sessão>") e o mesmo JID por outra
  sessão já escolhida ficam bloqueados com o motivo; selecionado com problema ganha aviso amarelo e o
  Salvar fica desligado até tirá-lo. Não troque esses bloqueios por "Valor fora do permitido".
- **Configurações** (`MonitoringSettingsForm`): card mestre "Monitoramento ativo"; horário (`RangeSlider`
  com `marks`, 00:00–24:00, passo 15 min, "Janela noturna"); envio; depois da captura; texto da oferta em
  `radiogroup` Original / Modelo / IA (setas, Home/End: `textModeForKey`) com `AudiencePicker` quando IA.
  Barra Salvar/Descartar só com alteração, `aria-live`. "Marcar todos" travado pelo plano conta como
  desligado (`effectiveDraft` com `PlanGates`), assim como "montar só com link" fora do PRO/MAX e "capturar fora do
  horário" fora do MAX. Opção exclusiva mostra sempre os selos dos planos que a incluem
  (`PlanAvailabilityBadges from="pro|max"`, prop `badge` do `ToggleOption`) e entra nos benefícios do
  `plans/catalog.ts` e na tabela da assinatura (`subscription/strings.ts`). Cards Horário, Envio,
  Depois da captura, Texto da oferta, Ofertas capturadas e Fila de envio nascem **recolhidos** (`MonitorCard collapseKey`) e lembram aberto/fechado
  por navegador (`ui.monitoring.card.<chave>`, `usePersistedState` escopo `browser`). "Formato da imagem"
  (`ImageModePicker`, `GroupMonitorConfig.imageMode`, padrão `LINK_PREVIEW`; `MEDIA` desligado, ver
  `docs/mensagens-previa-de-link.md`) é copiado para cada `Offer` criada; `LINK_PREVIEW` envia texto + cartão de prévia, com título =
  1ª linha do texto capturado (limitação do MVP). Ver `docs/mensagens-previa-de-link.md`.
- **Capturadas** (`CapturedOffersList`): filtros `all`/`action` (Precisa de ação)/`queued`/`working`/`skipped`
  com contagem (marcada parcial enquanto há mais páginas); horário relativo pt-BR pelo `serverNow()`, com
  data quando não é hoje; chips de `textSource`, "IA indisponível" (`aiErrorCode` no tooltip), foto
  indisponível só com `imageUnavailable`. Captura `QUEUED` traz `offerStatus`, `sentCount`/`totalCount` e
  Pausar / Retomar / Parar **da oferta** (`OfferControlButtons`, `features/sendQueue`); na fila
  (`SendQueuePanel`) os mesmos botões só na 1ª linha da oferta.

**Chaves persistidas** (`usePersistedState`, escopo aba):

| Chave | O quê |
|---|---|
| `monitoring.sessionId` | sessão escolhida |
| `monitoring.picker` | seletor aberto (`monitored`/`broadcast`) |
| `monitoring.picker.<mode>.<sessionId>` | rascunho de grupos do seletor |
| `monitoring.picker.search.<mode>.<sessionId>` | busca do seletor |
| `monitoring.picker.tab.<mode>.<sessionId>` | aba do seletor (xs) |
| `monitoring.picker.openKeywords.<sessionId>` | grupo com palavras-chave abertas |
| `monitoring.picker.sessionFilter.<mode>.<sessionId>` | filtro de sessão do seletor (`all` ou id) |
| `monitoring.settings.<sessionId>` | rascunho das configurações (form com `key={sessionId}`) |
| `monitoring.captured.filter.<sessionId>` | filtro das capturadas |
| `monitoring.captured.expanded.<sessionId>` | linhas expandidas |

Trocar de sessão fecha o seletor e apaga as chaves `monitoring.picker.*` da sessão anterior
(`clearPickerDraft` em `MonitoringPage.tsx`, mesmas chaves do `GroupPickerDialog`). Chave nova do
seletor entra nos dois lugares.

**Privacidade**: flags `monitoring.*` (sessão, `sessionAvatar`, nomes e fotos de grupos, `keywords`,
texto e imagens capturados). Credenciais: só nome da loja e data, sem flag.

## 6. O que não fazer

- Repassar link ou parâmetro de afiliado do grupo monitorado. Sempre a URL canônica + tenant.
- Enviar oferta vencida; cupom nunca ganha validade maior que oferta sem cupom.
- Anexar mídia que não seja JPEG/PNG/WebP do media store.
- Guardar grupos monitorados em memória para decidir captura.
- Criar `setInterval` novo; o processamento vai no tick do worker de envio.
- Chamar Baileys fora do adapter ou usar `raw` do evento.
- Ligar `GROUP_MONITORING_ENABLED` local (`api/.env` = produção): ela liga a captura (grava no
  banco) e o processamento (envia mensagens).
- Mandar texto do concorrente para a IA: só JSON de dados (`buildOfferTextPrompt`). Não criar segundo
  compositor nem segundo leitor de produto: `OfferTextComposer` e `ResolveProductDataUseCase` são únicos.
- Ler página de produto ML com cookie do servidor (captcha) ou bloquear a captura por falta de dados.
- Painel: ícone/efeito de brilho (`Sparkles`, `MoonStar`, "twinkle"); cor crua fora do tema; animação sem
  `REDUCED_MOTION`.
- Painel: comparar `Date.now()` com horário da API; usar `serverNow()`.
- Painel: "Desfazer" restaurar cópia antiga da lista; reinserir no estado atual (`reinsertGroup`), senão
  apaga o que mudou entre remover e desfazer.

## 7. Incidentes

- 2026-10-28 — link ML nunca gerado (bootstrap 404, vitrine social com id de catálogo):
  [`incidente-2026-10-28-link-ml.md`](incidente-2026-10-28-link-ml.md).

## 8. Próximos passos (fase 2)

- "Imagem das ofertas" (original × gerada).
- Fila BullMQ `monitoring.inbound` quando a escala chegar (`arquitetura-escala.md` §3.6).
- Telegram como origem/destino (`messaging` engine `telegram`): captura (foto, id composto, `msgType`) e
  envio (HTML, `FLOOD_WAIT` reagendado) prontos; falta teste contra o Telegram real (`sessoes-telegram.md` §8).
