# CopySync — Produto, funcionalidades e planos

Fonte de verdade do **que** o CopySync entrega e **como** é vendido. Toda feature nova deve
caber em um item desta lista (ou propor um novo aqui antes de nascer no código). A arquitetura
que sustenta isso está em [`../AGENTS.md`](../AGENTS.md); o estado do rebranding em
[`rebranding-copysync.md`](rebranding-copysync.md).

Atualizado em 2026-10-13. Nomes de módulo/feature em código seguem o **recurso**, nunca a marca
(white label): ex. `offer-generator`, `group-monitoring`, `link-rotation`.

## Posicionamento

Ferramenta para **afiliados** (Shopee, Mercado Livre, Amazon) que vivem de publicar ofertas em
grupos de WhatsApp/Telegram. O produto escuta grupos de concorrentes, troca o link de afiliado
pelo do cliente, reescreve o texto com IA e reposta nos grupos dele, no horário que ele escolher.

## Funcionalidades

| # | Funcionalidade | O que faz | Módulo sugerido (`api/src/modules/`) | Status |
|---|---|---|---|---|
| 1 | 📱 Conexão WhatsApp | Conecta números do cliente à ferramenta (QR / pairing code) | `sessions`, `messaging` (Baileys) | ✅ existe |
| 2 | ✈️ Conexão Telegram | Conecta conta Telegram para monitorar e postar | `messaging` engine `telegram` ([doc](sessoes-telegram.md)) | 🟡 conexão e limite por plano (api 0.51.0 · app 0.64.0); falta monitorar/disparar por Telegram |
| 3 | 🔑 Credenciais de afiliado | Liga contas Shopee, Mercado Livre e Amazon para gerar links | `integrations/affiliate-credentials` | ✅ |
| 4 | 👀 Monitoramento | Escuta grupos de concorrentes, troca o link pelo do cliente, reposta nos grupos dele | `automation/group-monitoring` (`docs/monitoramento-grupos.md`) | 🟡 WhatsApp, oferta montada e IA prontos; falta imagem e Telegram |
| 5 | 📤 Grupos de disparo | Grupos do cliente que recebem as ofertas | `campaigns/broadcast-groups` | ✅ ([doc](grupos-de-disparo-e-horario.md)) |
| 6 | ⏰ Horário de postagem | Janela de horários em que as ofertas saem | `campaigns/posting-schedule` | ✅ ([doc](grupos-de-disparo-e-horario.md)) |
| 7 | 🤖 Reescrita com IA | Reescreve o texto de cada oferta automaticamente | `assistants` (`docs/ia-provedores.md`) | ✅ gerador e monitoramento (`textMode: AI`) |
| 8 | ⚡ Gerador de ofertas | Cola o link → monta oferta (foto, preço, texto) e dispara | `campaigns/offers` (`docs/gerador-de-ofertas.md`) | ✅ v2: link do próprio afiliado, cupom, público-alvo com IA, marcar todos (`docs/gerador-de-ofertas.md`) |
| 9 | 🔄 Gestor de Links | Um link único que distribui pessoas entre os grupos | `link-rotation` ([doc](rodizio-de-links.md)) | ✅ |
| 10 | 📢 Disparo em massa | O que é postado num grupo é espelhado nos outros | `campaigns/broadcast-mirror` | ⏳ |
| 11 | 📸 Story de oferta | Gera stories de oferta prontos para Instagram | `offer-story` ([doc](story-de-oferta.md)) | ✅ MAX |
| 12 | 🛍️ Site de ofertas | Vitrine pública com as ofertas, para colocar na bio | `storefront` ([doc](pagina-de-ofertas.md)) | ✅ Página de Ofertas (PRO/MAX) |
| 13 | 🎓 Conta | Aulas e suporte pelo WhatsApp | `tenants` (entitlements) + conteúdo externo | ⏳ |
| 14 | 👥 Menção a todos | Post em grupo de disparo menciona todos os participantes (menção estruturada; metadata do grupo em cache) | `campaigns/broadcast-mention-all` sobre `sendTextMessage.mentions` | ⏳ (envio com `mentions` ✅ existe) |
| 15 | 🌐 Domínio personalizado | Site de ofertas e Gestor de Links servidos no domínio do cliente (CNAME + TLS automático) | `storefront/custom-domain` | ⏳ |
| 16 | 🎧 Níveis de suporte | Suporte 24/7, prioritário ou exclusivo conforme o plano; só muda fila/SLA, nada no código além do entitlement | `tenants` (entitlement `support_tier`) | ⏳ |

## Produtos (menu)

Desde app 0.61.0 o painel agrupa as telas por produto ([`navegacao-produtos.md`](navegacao-produtos.md)).
Produto novo nasce aqui antes de entrar no menu. Números referem-se à tabela acima.

| Produto | Status | Funcionalidades |
|---|---|---|
| Afiliados | disponível | 3, 4, 8, 9, 11, 12 |
| CRM & Automação | em breve | chat/atendimento, fluxos por blocos, assistentes de IA (`/chat` já existe, só super admin) |
| Gestor de Grupos | em breve | 5, 10, 14 |
| Saver | em breve | a definir |
| Aquecedor de Chip | em breve | a definir |
| Lotar Grupos | em breve | a definir (entrada de novos membros nos grupos do cliente) |

## Ferramentas operacionais da plataforma

Não são produto nem item de plano: só o super-admin usa, fora do menu dos tenants (seção Plataforma).

| Ferramenta | O que faz | Módulo | Status |
|---|---|---|---|
| Links de redirecionamento | Links curtos da plataforma (`/redirect/<slug>`) para suporte, loja, vídeos e Web Store, com divisão A/B e cliques | `redirect-links` ([doc](redirect-links.md)) | ✅ api 0.67.0 · app 0.85.0 |

Sessão (número conectado, item 1) é do tenant: a mesma sessão serve mais de um produto; limite segue
por plano, não por produto. Plano, permissões e configurações por produto: etapa futura.

## Planos (rascunho 2026-10-13)

Esta tabela é o conjunto de planos do produto **Afiliados**. Cada produto do menu (CRM & Automação,
Gestor de Grupos, Saver, Aquecedor de Chip, Lotar Grupos) terá o seu próprio conjunto de planos, definido quando
o produto nascer; não existe plano global.

Limites são **entitlements por tenant**: devem viver em dado (`Tenant.planSlug` + `TenantEntitlement`,
ver `arquitetura-central-billing.md`), nunca hardcoded em use case. Enforcement no `application` layer, com erro interno
`PLAN_LIMIT_REACHED` (a criar em `shared/errors`). Preço "de/por" é só marketing; o sistema
guarda o plano, não o preço.

| Limite | 🟢 LITE — R$ 97/mês (de 161,90) | 🔵 PRO — R$ 167/mês (de 278,90) ⭐ | 🟣 MAX — R$ 247/mês (de 411,90) |
|---|---|---|---|
| Conexões WhatsApp | 1 | 1 | 2 |
| Conexões Telegram | — | 1 | 2 |
| Grupos monitorados — WhatsApp / Telegram | 1 / — | 2 / 2 | 6 / 6 |
| Grupos de disparo — WhatsApp / Telegram | 5 / — | 10 / 10 | 40 / 40 |
| Disparo em massa | ✅ | ✅ | ✅ |
| Agendamento de horários | ✅ | ✅ | ✅ |
| Gestor de Links — WhatsApp (links · grupos por link) | 1 · 3 | 1 · 5 | 2 · 10 |
| Gestor de Links — Telegram (links · grupos por link) | — | 1 · 5 | 2 · 10 |
| Menção a todos os participantes | — | ✅ | ✅ |
| Marketplaces (Shopee, Amazon, ML) | ✅ | ✅ | ✅ |
| Gerador de ofertas | ✅ | ✅ | ✅ |
| Envio "digitando…" antes da oferta | ✅ | ✅ | ✅ |
| Monitorar numa sessão e disparar em outra do mesmo canal (sessão cruzada) | — | — | ✅ (exclusivo) |
| Site pra bio | — | ✅ | ✅ |
| Domínio personalizado | — | ✅ | ✅ |
| Template Instagram | — | — | ✅ (exclusivo) |
| Suporte | 24/7 | prioritário 24/7 | exclusivo 24/7 |
| Aulas em vídeo | ✅ | ✅ | ✅ |

Não aparecem na tabela de venda e ficam como entitlement interno, default ligado nos três:
reescrita com IA (`ai_rewrite_enabled`), limite diário do gerador (`offer_generations_per_day`,
decisão 2026-11-04: LITE 5, PRO 20, MAX ilimitado = `null` explícito no preset).

Versão anterior (Básico/Plus/Pro, R$ 99/169/299) fica substituída por esta. Telegram no
PRO e MAX repete os mesmos limites de grupos do WhatsApp ("monitora 2 + 10 de
envio" por canal).

**Limites por canal** (`tenants/domain/channelLimits.ts`): o canal de uma sessão é a engine
(`baileys` = WhatsApp, `telegram`); o de um grupo é a engine da **sessão dona** (monitorado: sessão do
monitor; disparo: `BroadcastGroup.sessionId`; gerador: sessão do grupo). Chaves: `whatsapp_sessions` /
`telegram_sessions`, `monitored_groups` / `telegram_monitored_groups`, `broadcast_groups` /
`telegram_broadcast_groups` (as sem prefixo são do WhatsApp; não renomear). Presets Telegram: LITE 0/0,
PRO 2/10, MAX 6/40. Gestor de Links (canal = engine da sessão do rodízio): `link_rotations` /
`telegram_link_rotations` e `link_rotation_groups` / `telegram_link_rotation_groups` (Telegram LITE 0/0,
PRO 1/5, MAX 2/10). Cada canal conta e corta sozinho; `PLAN_LIMIT_REACHED` (403) leva `meta.key` do canal.
`cross_session_dispatch` só é exigido com **2+ sessões do mesmo canal**; WhatsApp + Telegram juntos
sempre podem. Nada de chave literal em use case: `channelLimitKey(kind, engine)` / `limitKeyOfChannel`.

### Carga por plano (entrada do estudo de arquitetura)

Base para [`arquitetura-escala.md`](arquitetura-escala.md). Estimativas, não medições.

| Por tenant | LITE | PRO | MAX |
|---|---|---|---|
| Sessões WhatsApp (Baileys) | 1 | 1 | 2 |
| Sessões Telegram (engine leve, Bot API/MTProto) | 0 | 1 | 2 |
| Mensagens de entrada/dia (grupos-fonte × ~150 msg) | ~150 | ~300 | ~900 |
| Posts de saída/dia (ofertas × grupos de disparo; ~20 ofertas/dia) | ~100 | ~200 | ~800 |
| Metadata de grupo em cache | 6 | 12 | 46 |

Mix de referência para 1.000 tenants (50% / 35% / 15%): **1.150 sessões WhatsApp**,
650 Telegram, ~350 mil msgs de entrada/dia, ~300 mil posts/dia (~3,5/s médio, picos 10×
nas janelas agendadas). O gargalo é o **envio em rajada nas janelas de horário**, não a
escuta: fila por sessão com rate limit é obrigatória (item 3.6 do doc de escala).

Chaves de entitlement sugeridas (snake_case, estáveis):
`whatsapp_sessions`, `telegram_sessions`, `monitored_groups`, `broadcast_groups`,
`telegram_monitored_groups`, `telegram_broadcast_groups`,
`offer_generations_per_day` (`null` = ilimitado), `link_rotations`, `link_rotation_groups`,
`telegram_link_rotations`, `telegram_link_rotation_groups`, `ai_rewrite_enabled`,
`offer_story_enabled`, `storefront_enabled`, `mention_all_enabled`, `custom_domain_enabled`,
`support_tier` (`standard | priority | exclusive`).

Billing: via API central, ver [`arquitetura-central-billing.md`](arquitetura-central-billing.md) (reaproveitar
API central para checkout/assinatura; tenant guarda `billingCustomerId`).

## Ordem sugerida de entrega

1. **Credenciais de afiliado** + **Gerador de ofertas** — valor imediato, sem depender de monitoramento.
2. **Grupos de disparo** + **Horário de postagem** + **Disparo em massa** — base de distribuição.
3. **Monitoramento** com troca de link — núcleo do produto, depende de 1 e 2.
4. **Reescrita com IA** — plug no pipeline de 3.
5. **Gestor de Links**, **Story**, **Site de ofertas**, **Domínio personalizado** — diferenciais PRO/MAX (Story só MAX).
5b. **Menção a todos** — depende de `cachedGroupMetadata` com TTL (doc de escala, seção 7).
6. **Telegram** — segundo engine atrás de `MessagingEngine`.
7. **Planos e limites** — pode entrar cedo como tabela, com enforcement crescendo por feature.

## Copy de referência (tela de login e marketing)

- Promessa: *"Suas ofertas de afiliado publicadas no automático."*
- Como: monitora grupos, troca o link pelo seu, reescreve com IA, dispara nos seus grupos.
- Provas: WhatsApp + Telegram · Shopee, Mercado Livre e Amazon · horário programado · Gestor de Links.
