# CopySync — Produto, funcionalidades e planos

Fonte de verdade do **que** o CopySync entrega e **como** é vendido. Toda feature nova deve
caber em um item desta lista (ou propor um novo aqui antes de nascer no código). A arquitetura
que sustenta isso está em [`../AGENTS.md`](../AGENTS.md); o estado do rebranding em
[`rebranding-copysync.md`](rebranding-copysync.md).

Atualizado em 2026-10-12. Nomes de módulo/feature em código seguem o **recurso**, nunca a marca
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
| 3 | 🔑 Credenciais de afiliado | Liga contas Shopee, Mercado Livre e Amazon para gerar links | `integrations/affiliate-credentials` | ⏳ |
| 4 | 👀 Monitoramento | Escuta grupos de concorrentes, troca o link pelo do cliente, reposta nos grupos dele | `automation/group-monitoring` | ⏳ |
| 5 | 📤 Grupos de disparo | Grupos do cliente que recebem as ofertas | `campaigns/broadcast-groups` | ⏳ |
| 6 | ⏰ Horário de postagem | Janela de horários em que as ofertas saem | `campaigns/posting-schedule` | ⏳ |
| 7 | 🤖 Reescrita com IA | Reescreve o texto de cada oferta automaticamente | `assistants/offer-rewriter` | ⏳ |
| 8 | ⚡ Gerador de ofertas | Cola o link → monta oferta (foto, preço, texto) e dispara | `campaigns/offer-generator` | ⏳ |
| 9 | 🔄 Rodízio de links | Um link único que distribui pessoas entre os grupos | `campaigns/link-rotation` | ⏳ |
| 10 | 📢 Disparo em massa | O que é postado num grupo é espelhado nos outros | `campaigns/broadcast-mirror` | ⏳ |
| 11 | 📸 Story de oferta | Gera stories de oferta prontos para Instagram | `campaigns/offer-story` | ⏳ |
| 12 | 🛍️ Site de ofertas | Vitrine pública com as ofertas, para colocar na bio | `storefront` (novo módulo) | ⏳ |
| 13 | 🎓 Conta | Aulas e suporte pelo WhatsApp | `tenants` (entitlements) + conteúdo externo | ⏳ |

## Planos

Limites são **entitlements por tenant**: devem viver em dado (ex. `Tenant.plan` + tabela de
limites), nunca hardcoded em use case. Enforcement no `application` layer, com erro interno
`PLAN_LIMIT_REACHED` (a criar em `shared/errors`).

| Limite | 🟢 Básico — R$ 99/mês | 🔵 Plus — R$ 169/mês ⭐ | 🟣 Pro — R$ 299/mês |
|---|---|---|---|
| Números WhatsApp | 1 | 2 | 5 |
| Telegram | — | ✅ | ✅ |
| Grupos monitorados | 1 | 6 | 30 |
| Grupos de disparo | 5 | 10 | 40 |
| Gerador de ofertas | 10/dia | 20/dia | ilimitado |
| Rodízios de links | 1 | 2 | 5 |
| Reescrita com IA | — | ✅ | ✅ |
| Story de oferta (Instagram) | — | ✅ | ✅ |
| Site de ofertas | — | ✅ | ✅ |
| Credenciais de afiliado | ✅ | ✅ | ✅ |
| Horário de postagem | ✅ | ✅ | ✅ |
| Disparo em massa | ✅ | ✅ | ✅ |
| Aulas e suporte | ✅ | ✅ | ✅ |

Chaves de entitlement sugeridas (snake_case, estáveis):
`whatsapp_sessions`, `telegram_enabled`, `monitored_groups`, `broadcast_groups`,
`offer_generations_per_day` (`null` = ilimitado), `link_rotations`, `ai_rewrite_enabled`,
`offer_story_enabled`, `storefront_enabled`.

Billing: ver análise em `.specs/features/service-desk/integracao-api-central.md` (reaproveitar
API central para checkout/assinatura; tenant guarda `billingCustomerId`).

## Ordem sugerida de entrega

1. **Credenciais de afiliado** + **Gerador de ofertas** — valor imediato, sem depender de monitoramento.
2. **Grupos de disparo** + **Horário de postagem** + **Disparo em massa** — base de distribuição.
3. **Monitoramento** com troca de link — núcleo do produto, depende de 1 e 2.
4. **Reescrita com IA** — plug no pipeline de 3.
5. **Rodízio de links**, **Story**, **Site de ofertas** — diferenciais Plus/Pro.
6. **Telegram** — segundo engine atrás de `MessagingEngine`.
7. **Planos e limites** — pode entrar cedo como tabela, com enforcement crescendo por feature.

## Copy de referência (tela de login e marketing)

- Promessa: *"Suas ofertas de afiliado publicadas no automático."*
- Como: monitora grupos, troca o link pelo seu, reescreve com IA, dispara nos seus grupos.
- Provas: WhatsApp + Telegram · Shopee, Mercado Livre e Amazon · horário programado · rodízio de links.
