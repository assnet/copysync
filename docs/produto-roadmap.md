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
| 2 | ✈️ Conexão Telegram | Conecta conta Telegram para monitorar e postar | `messaging` (novo engine `telegram` atrás de `MessagingEngine`) | ⏳ |
| 3 | 🔑 Credenciais de afiliado | Liga contas Shopee, Mercado Livre e Amazon para gerar links | `integrations/affiliate-credentials` | ✅ |
| 4 | 👀 Monitoramento | Escuta grupos de concorrentes, troca o link pelo do cliente, reposta nos grupos dele | `automation/group-monitoring` (`docs/monitoramento-grupos.md`) | 🟡 WhatsApp, oferta montada e IA prontos; falta imagem e Telegram |
| 5 | 📤 Grupos de disparo | Grupos do cliente que recebem as ofertas | `campaigns/broadcast-groups` | ⏳ |
| 6 | ⏰ Horário de postagem | Janela de horários em que as ofertas saem | `campaigns/posting-schedule` | ⏳ |
| 7 | 🤖 Reescrita com IA | Reescreve o texto de cada oferta automaticamente | `assistants` (`docs/ia-provedores.md`) | ✅ gerador e monitoramento (`textMode: AI`) |
| 8 | ⚡ Gerador de ofertas | Cola o link → monta oferta (foto, preço, texto) e dispara | `campaigns/offers` (`docs/gerador-de-ofertas.md`) | ✅ v2: link do próprio afiliado, cupom, público-alvo com IA, marcar todos (`docs/gerador-de-ofertas.md`) |
| 9 | 🔄 Rodízio de links | Um link único que distribui pessoas entre os grupos | `link-rotation` ([doc](rodizio-de-links.md)) | ✅ |
| 10 | 📢 Disparo em massa | O que é postado num grupo é espelhado nos outros | `campaigns/broadcast-mirror` | ⏳ |
| 11 | 📸 Story de oferta | Gera stories de oferta prontos para Instagram | `offer-story` ([doc](story-de-oferta.md)) | ✅ Business |
| 12 | 🛍️ Site de ofertas | Vitrine pública com as ofertas, para colocar na bio | `storefront` ([doc](pagina-de-ofertas.md)) | ✅ Página de Ofertas (Profissional/Business) |
| 13 | 🎓 Conta | Aulas e suporte pelo WhatsApp | `tenants` (entitlements) + conteúdo externo | ⏳ |
| 14 | 👥 Menção a todos | Post em grupo de disparo menciona todos os participantes (menção estruturada; metadata do grupo em cache) | `campaigns/broadcast-mention-all` sobre `sendTextMessage.mentions` | ⏳ (envio com `mentions` ✅ existe) |
| 15 | 🌐 Domínio personalizado | Site de ofertas e rodízio de links servidos no domínio do cliente (CNAME + TLS automático) | `storefront/custom-domain` | ⏳ |
| 16 | 🎧 Níveis de suporte | Suporte 24/7, prioritário ou exclusivo conforme o plano; só muda fila/SLA, nada no código além do entitlement | `tenants` (entitlement `support_tier`) | ⏳ |

## Planos (rascunho 2026-10-13)

Limites são **entitlements por tenant**: devem viver em dado (`Tenant.planSlug` + `TenantEntitlement`,
ver `arquitetura-central-billing.md`), nunca hardcoded em use case. Enforcement no `application` layer, com erro interno
`PLAN_LIMIT_REACHED` (a criar em `shared/errors`). Preço "de/por" é só marketing; o sistema
guarda o plano, não o preço.

| Limite | 🟢 Starter — R$ 97/mês (de 161,90) | 🔵 Profissional — R$ 167/mês (de 278,90) ⭐ | 🟣 Business — R$ 247/mês (de 411,90) |
|---|---|---|---|
| Conexões WhatsApp | 1 | 1 | 2 |
| Conexões Telegram | — | 1 | 2 |
| Grupos monitorados (por canal) | 1 | 2 | 6 |
| Grupos de disparo (por canal) | 5 | 10 | 40 |
| Disparo em massa | ✅ | ✅ | ✅ |
| Agendamento de horários | ✅ | ✅ | ✅ |
| Rodízio de links inteligentes | ✅ | ✅ | ✅ |
| Menção a todos os participantes | — | ✅ | ✅ |
| Marketplaces (Shopee, Amazon, ML) | ✅ | ✅ | ✅ |
| Gerador de ofertas | ✅ | ✅ | ✅ |
| Envio "digitando…" antes da oferta | ✅ | ✅ | ✅ |
| Monitorar em um WhatsApp e disparar em outro (sessão cruzada) | — | — | ✅ (exclusivo) |
| Site pra bio | — | ✅ | ✅ |
| Domínio personalizado | — | ✅ | ✅ |
| Template Instagram | — | — | ✅ (exclusivo) |
| Suporte | 24/7 | prioritário 24/7 | exclusivo 24/7 |
| Aulas em vídeo | ✅ | ✅ | ✅ |

Não aparecem na tabela de venda e ficam como entitlement interno, default ligado nos três:
reescrita com IA (`ai_rewrite_enabled`), limite diário do gerador (`offer_generations_per_day`,
`null` = ilimitado; sugerido 20 no Profissional e `null` no Business).

Versão anterior (Básico/Plus/Pro, R$ 99/169/299) fica substituída por esta. Telegram no
Profissional e Business repete os mesmos limites de grupos do WhatsApp ("monitora 2 + 10 de
envio" por canal).

### Carga por plano (entrada do estudo de arquitetura)

Base para [`arquitetura-escala.md`](arquitetura-escala.md). Estimativas, não medições.

| Por tenant | Starter | Profissional | Business |
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
`whatsapp_sessions`, `telegram_enabled`, `monitored_groups`, `broadcast_groups`,
`offer_generations_per_day` (`null` = ilimitado), `link_rotations`, `ai_rewrite_enabled`,
`offer_story_enabled`, `storefront_enabled`, `mention_all_enabled`, `custom_domain_enabled`,
`support_tier` (`standard | priority | exclusive`).

Billing: via API central, ver [`arquitetura-central-billing.md`](arquitetura-central-billing.md) (reaproveitar
API central para checkout/assinatura; tenant guarda `billingCustomerId`).

## Ordem sugerida de entrega

1. **Credenciais de afiliado** + **Gerador de ofertas** — valor imediato, sem depender de monitoramento.
2. **Grupos de disparo** + **Horário de postagem** + **Disparo em massa** — base de distribuição.
3. **Monitoramento** com troca de link — núcleo do produto, depende de 1 e 2.
4. **Reescrita com IA** — plug no pipeline de 3.
5. **Rodízio de links**, **Story**, **Site de ofertas**, **Domínio personalizado** — diferenciais Profissional/Business (Story só Business).
5b. **Menção a todos** — depende de `cachedGroupMetadata` com TTL (doc de escala, seção 7).
6. **Telegram** — segundo engine atrás de `MessagingEngine`.
7. **Planos e limites** — pode entrar cedo como tabela, com enforcement crescendo por feature.

## Copy de referência (tela de login e marketing)

- Promessa: *"Suas ofertas de afiliado publicadas no automático."*
- Como: monitora grupos, troca o link pelo seu, reescreve com IA, dispara nos seus grupos.
- Provas: WhatsApp + Telegram · Shopee, Mercado Livre e Amazon · horário programado · rodízio de links.
