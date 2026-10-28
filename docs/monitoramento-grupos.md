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
   - sem credencial do marketplace → `SKIPPED/CREDENTIAL_MISSING`; erro da API →
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

Mercado Livre "social" (vitrine `meli.la` → `/social/<etiqueta>`): o produto vem do `product_id`
da página, lida com a sessão do tenant (1º produto da vitrine). Rede só dentro da allowlist
(`isSupportedProductUrl`, expansor e leitor de página). Diferente do gerador, que exige o link já
ser do operador, aqui o link é sempre gerado.

### 2.2 Janela de operação

Minutos do dia em `America/Sao_Paulo`, 0..1440. **Padrão 06:00–18:00** (`360–1080`). `0–1440` = sem
restrição. `fim < início` = cruza a
meia-noite (`22:00 → 06:00`); `1440` como início equivale a 00:00 do dia seguinte. A janela só
ancora o **início**: com muitos destinos, os envios seguintes podem passar do fim (a validade
limita). Recorte completo fica para a fase 2.

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
- Tentar de novo (`POST /captured/:id/retry`): só `SKIPPED`/`FAILED` com motivo recuperável
  (`CREDENTIAL_MISSING`, `LINK_RESOLVE_FAILED`, `NO_BROADCAST_GROUPS`, `MONITOR_DISABLED`,
  `INTERNAL_ERROR`). A validade continua contando da captura original.

## 4. Rotas (`/api/automation/group-monitoring`)

| Método | Rota | Uso |
|---|---|---|
| GET | `/config?sessionId` | regras, grupos (nome/foto da conversa), limites e uso no tenant |
| PUT | `/config` | salva as regras da sessão |
| PUT | `/config/monitored-groups` | substitui `{ groupJid, keywords }[]` |
| PUT | `/config/broadcast-groups` | substitui `groupJid[]` (ordem = envio) |
| GET | `/captured?sessionId&cursor` | capturas, mais recentes primeiro, 20 por página (cursor assinado) |
| POST | `/captured/:id/retry` | volta para `PENDING` |

## 5. Painel

- Seletor de sessão (persistido em `monitoring.sessionId`). "Conectar nova sessão" leva a
  `/sessions?create=1&returnTo=/monitoring`; ao fechar o assistente volta para
  `/monitoring?sessionId=<nova>` já selecionada (`safeReturnPath` só aceita caminho interno).
- Cards Sessão / Grupos monitorados n/max / Grupos de disparo n/max; seletor de grupos com busca e
  palavras-chave; grupo já usado no outro papel aparece bloqueado.
- Regras: horário (só `RangeSlider` com `marks`, 00:00–24:00, passo 15 min, "Janela noturna"),
  envio (intervalo, digitando, marcar todos), depois da captura (atraso, validades). Rascunho por
  sessão (`monitoring.settings.<sessionId>`, formulário com `key={sessionId}`), Salvar/Descartar só
  com alteração. "Reescrita com IA" e "Imagem das ofertas" aparecem como "Em breve".
- Ofertas capturadas (status, motivo, cupom, foto indisponível, "Tentar de novo") e a fila de envio
  da sessão (`SendQueuePanel`).
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
- Reescrever texto com IA nesta fase (fase 2, via `IAiTextGenerator`).

## 7. Próximos passos (fase 2)

- Reescrita com IA e "imagem das ofertas" (original × gerada).
- Fila BullMQ `monitoring.inbound` quando a escala chegar (`arquitetura-escala.md` §3.6).
- Recorte dos envios pelo fim da janela.
- Telegram como origem/destino (`messaging` engine `telegram`).
