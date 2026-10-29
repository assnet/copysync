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
| Link do tenant | `campaigns/application/use-cases/BuildTenantAffiliateLinkUseCase.ts` |
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
   isso (remover o grupo não desliga). Vídeo, GIF ou foto sem download → oferta só com texto; foto
   que falhou fica marcada `imageUnavailable`.
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
   - início = captura + atraso, empurrado para o próximo início da janela; se cair depois da
     validade → `SKIPPED/EXPIRED` (oferta/cupom vencido não é distribuído);
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

Mercado Livre "social" (vitrine `meli.la` → `/social/<etiqueta>?…&ref=…`): o produto vem do `product_id`
da página (1º card; com o `ref` da query a ML abre o produto do link). É id de **catálogo**, logo a
URL enviada ao `createLink` é `/p/<product_id>`, nunca `produto…/MLB-` (ML devolve 100). A vitrine
é pública e é lida **sem** cookie (com cookie do servidor a ML manda para o captcha). Rede só dentro da allowlist
(`isSupportedProductUrl`, expansor e leitor de página). Diferente do gerador, que exige o link já
ser do operador, aqui o link é sempre gerado.

### 2.1.1 Texto da oferta: original, modelo ou IA (api 0.41.0)

Config por sessão: `textMode` (`ORIGINAL` padrão | `TEMPLATE` | `AI`), `audience` (públicos do gerador;
`STANDARD` = modelo) e `enrichLinkOnly` (padrão `true`). Depois do link do tenant e antes de enfileirar
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
4. Foto: a da mensagem; sem ela, a do produto via `IMonitorImageStore` (fetcher + media store do gerador,
   allowlist `mlstatic.com`/`susercontent.com`/`media-amazon.com`).

Entitlement de IA: o mesmo do gerador (`ai_rewrite_enabled`, resolvido dentro do `IAiTextGenerator`;
decisão do owner 2026-10-28: IA em todos os planos por enquanto). Limite diário de IA: o mesmo
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
mostrar horários reais. O gerador de ofertas não é afetado pela janela.

**Capturar fora do horário** (`captureOutsideWindow`, padrão ligado): fora da janela a captura
continua e as ofertas acumulam na fila, saindo quando ela abrir (a validade conta da captura).
Desligado, mensagem fora da janela não é capturada nem entra na fila (`outside_window` no
listener, sem linha no banco). Sem efeito com janela de dia inteiro.

## 3. Regras e limites

- Faixas: intervalo 60–3600 s (min ≤ max; **padrão 15–40 min**, mais espaçado que o gerador),
  atraso 0–7200 s, validade 15–1440 min, validade com
  cupom ≤ validade sem cupom, "digitando…" 1–30 s. 422 `GROUP_MONITOR_INVALID_INPUT` com `field`.
- Plano: `monitored_groups` e `broadcast_groups` somam **todas as sessões do tenant**
  (`PLAN_LIMIT_REACHED`); `mention_all_enabled=false` bloqueia "marcar todos"
  (`PLAN_FEATURE_UNAVAILABLE`) e o worker envia sem marcar.
- O mesmo grupo não pode ser monitorado e de disparo no tenant (409
  `GROUP_MONITOR_GROUP_CONFLICT`): a oferta postada voltaria como captura.
- Só grupo de que a sessão participa (mesma regra do gerador); a conversa do chat é criada se faltar.
- **Sessão cruzada** (api 0.42.0): grupo de disparo pode ser de **outra sessão do tenant**
  (`groups[].sessionId` no `PUT /config/broadcast-groups`), com o entitlement `cross_session_dispatch`
  (Business; ausente = bloqueado, 403 `PLAN_FEATURE_UNAVAILABLE`). A sessão de destino tem de existir
  no tenant (404). O limite `broadcast_groups` conta por monitoramento (config), não pela sessão dona
  do grupo. O mesmo grupo (sessão + JID) não pode ser destino de dois monitoramentos (422). No envio,
  cada destino entra na faixa da **sua** sessão (`EnqueueOfferUseCase` multi-sessão); plano rebaixado
  depois de salvar → só os grupos da própria sessão saem. Chaves de entitlement centralizadas em
  `tenants/domain/entitlementKeys.ts`; presets por plano em `tenants/domain/planPresets.ts` (seed).
- Tentar de novo (`POST /captured/:id/retry`): só `SKIPPED`/`FAILED` com motivo recuperável
  (`CREDENTIAL_MISSING`, `CREDENTIAL_REJECTED`, `LINK_RESOLVE_FAILED`, `NO_BROADCAST_GROUPS`, `MONITOR_DISABLED`,
  `INTERNAL_ERROR`). A validade continua contando da captura original.
- Aviso de credencial (`credentialAlerts`, só no `GET /config`): por loja, `REJECTED` (`rejectedAt`) ou `MISSING`
  (credencial não utilizável + captura `CREDENTIAL_MISSING` nos últimos 7 dias). Um por loja; recusada prevalece.
  Save* não devolvem o campo; o painel mantém o anterior até o próximo load.

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

- Seletor de sessão (persistido em `monitoring.sessionId`). "Conectar nova sessão" leva a
  `/settings/sessions?create=1&returnTo=/monitoring`; ao fechar o assistente volta para
  `/monitoring?sessionId=<nova>` já selecionada (`safeReturnPath` só aceita caminho interno).
- Cards Sessão / Grupos monitorados n/max / Grupos de disparo n/max; seletor de grupos com busca e
  palavras-chave; grupo já usado no outro papel aparece bloqueado.
- Regras: horário (só `RangeSlider` com `marks`, 00:00–24:00, passo 15 min, "Janela noturna"),
  envio (intervalo, digitando, marcar todos), depois da captura (atraso, validades). Rascunho por
  sessão (`monitoring.settings.<sessionId>`, formulário com `key={sessionId}`), Salvar/Descartar só
  com alteração. Card "Texto da oferta": Original / Modelo / Reescrita com IA (`ToggleButtonGroup`),
  `AudiencePicker` do gerador quando IA, switch "Montar a oferta quando chegar só o link".
  "Imagem das ofertas" segue "Em breve".
- Captura mostra chip "Texto original / do modelo / da IA" (`textSource`) e "IA indisponível" com o
  código no tooltip (`aiErrorCode`).
- `CredentialAlerts` no topo: um `Alert` por loja (sem credencial = aviso; recusada = erro, com data) e
  botão "Configurar credencial" → `/settings/affiliate-credentials?returnTo=/monitoring` (lá, "Voltar ao
  monitoramento"). Só nome da loja e data: sem flag de privacidade nova.
- Grupos de disparo: com `limits.crossSessionDispatch` o seletor lista os grupos de todas as sessões
  conectadas (nome da sessão em cada um) e o card mostra "Envia por <sessão>" no grupo de outra sessão;
  sem a feature, só a sessão atual e um aviso "exclusivo do plano Business" com link para `/plans`.
- Ofertas capturadas (status, motivo, cupom, foto indisponível, "Tentar de novo") e a fila de envio
  da sessão (`SendQueuePanel`). Captura `QUEUED` traz `offerStatus`, `sentCount`/`totalCount` e os
  botões Pausar / Retomar / Parar **da oferta** (`OfferControlButtons`, `features/sendQueue`): é o
  lugar natural do controle, um por oferta. Na fila os mesmos botões aparecem só na 1ª linha da oferta.
- Privacidade: flags `monitoring.*` (sessão, nomes e fotos de grupos, texto e imagens capturados).

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

## 7. Incidentes

- 2026-10-28 — link ML nunca gerado (bootstrap 404, vitrine social com id de catálogo):
  [`incidente-2026-10-28-link-ml.md`](incidente-2026-10-28-link-ml.md).

## 8. Próximos passos (fase 2)

- "Imagem das ofertas" (original × gerada).
- Fila BullMQ `monitoring.inbound` quando a escala chegar (`arquitetura-escala.md` §3.6).
- Telegram como origem/destino (`messaging` engine `telegram`).
