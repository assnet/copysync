# Gerador v2 + Nova sessão guiada + Provedores de IA — Spec e design

**Data:** 2026-10-26 · Referência visual: telas do modelo enviadas pelo owner (assistente de conexão em 4 passos;
gerador com configuração Sessão → Grupos → Confirmar, depois link + cupom + público + IA + prévia + disparo).
Migration única: `20261026210000_add_session_phone_ai_providers_offer_config` (já no schema).
Termo de produto: **sessão** (nunca "instância"). Textos para usuário leigo, pt-BR, sem marca ("a ferramenta").

## Decisões do owner

| Tema | Decisão |
| --- | --- |
| IA | Dois modos: **IA da plataforma** (super admin cadastra provedores/chaves/modelos, limites) e **chave do tenant**. Super admin liga/desliga cada modo; **nunca os dois desligados**. Modo desligado some da interface. Se a IA da plataforma está desligada **ou** o plano não tem o recurso, o tenant vê os campos para cadastrar a própria chave (se esse modo estiver ligado) |
| Link | Usuário cola o **próprio** link de afiliado. Bloquear quando dá para provar que é de terceiro (Amazon `tag=`, ML `matt_word`); Shopee só avisa |
| Dados ML/Amazon | Tentar automático (leitura da página: `og:*`, JSON-LD, preço), cair para manual |
| Número da sessão | Gravado como `Session.declaredPhone`; QR Code padrão + "Conectar com código" (pareamento por número); ao conectar, avisar se o aparelho é outro número |

---

## Parte A — Nova sessão guiada (`sessions`)

Assistente em 4 passos no lugar do `CreateSessionDialog`:
1. **Seu número do WhatsApp** — caixa de orientação ("Digite só números, com DDD. Ex.: 11987654321"); aceita 10–11 dígitos (DDD+número) ou 12–13 com 55; normaliza para `55DDDNÚMERO`.
2. **Dê um nome para esta sessão** — ex. "Ofertas da loja"; 2–40 caracteres, livre (é só um rótulo). Botão "Criar e conectar" cria e chama `connect`.
3. **Conectar** — QR Code com orientação passo a passo (WhatsApp → Aparelhos conectados → Conectar um aparelho), **contagem regressiva** do QR atual (reinicia quando o QR muda; a Baileys troca ~a cada 20 s), "Aguardando conexão…", "Gerar novo QR" quando expira/falha, link **"Prefiro conectar com código"** → mostra código de 8 caracteres e instruções ("Conectar com número de telefone").
4. **Conectado** — sucesso com número; aviso se `phone` ≠ `declaredPhone`.

API:
- `POST /sessions` aceita `declaredPhone?` (validado/normalizado no use case; 422 `SESSION_PHONE_INVALID`).
- `POST /sessions/:id/pairing-code` → inicia pareamento por código com `declaredPhone` (ou `{ phone }` no corpo). Implementar no adapter Baileys: `socket.requestPairingCode(phone)` quando o socket está conectando (primeiro `qr` do `connection.update`), `registry.setPairingCode`, status `AWAITING_PAIRING`. `GET /:id/pairing-code` já lê o registry.
- Resposta da sessão inclui `declaredPhone` e `phoneMismatch: boolean`.

## Parte B — Provedores de IA (`assistants`)

Tabelas: `PlatformSetting`, `AiPlatformProvider`, `TenantAiCredential`, `AiUsageLog`. Chaves via `ISecretCipher`
(AAD `platform:ai:<id>` e `<tenantId>:ai:apikey`); **nunca** devolvidas nem logadas (só `••••1234`).

Settings: `ai.platform.enabled` (padrão true), `ai.tenant_keys.enabled` (padrão true). Update que desligaria os dois → 422 `AI_MODES_BOTH_DISABLED`.

Resolução (`ResolveAiTextProviderUseCase(tenantId)`), em ordem:
1. plataforma ligada **e** entitlement `ai_rewrite_enabled` ≠ false (ausente = true) **e** existe provedor `enabled` → menor `priority`; respeita `dailyLimitPerTenant` contando `AiUsageLog` do dia (source PLATFORM) → `AI_DAILY_LIMIT_REACHED` 429.
2. senão, chaves do tenant ligadas **e** `TenantAiCredential.enabled` → chave do tenant.
3. senão → `AI_NOT_CONFIGURED` 409 (painel mostra o caminho certo).

Porta para consumidores: `IAiTextGenerator.generate({ tenantId, purpose, system, prompt, maxOutputTokens }) → { text }`
(em `assistants/domain/contracts`). Grava `AiUsageLog` (sucesso/falha, tokens). Adapters por `fetch` com timeout 30 s:
`AnthropicTextAdapter` (Messages API; padrão `claude-haiku-5-5`), `OpenAiTextAdapter` (Chat Completions). Erros do provedor →
`AI_PROVIDER_REJECTED` (chave inválida, 422), `AI_PROVIDER_UNAVAILABLE` (503), `AI_PROVIDER_RATE_LIMITED` (429). Sem corpo/chave em log.

Rotas:
- Super admin (`authHook` + `superAdminHook`), prefixo `/admin/ai`: `GET/PUT /settings`, `GET/POST /providers`, `PATCH/DELETE /providers/:id`, `POST /providers/:id/test`.
- Tenant (`authHook` + `tenantHook`), prefixo `/ai`: `GET /status` → `{ mode: 'PLATFORM'|'TENANT'|'NONE', tenantKeysAllowed, platformAvailable, credential: { kind, model, masked, enabled } | null }`; `PUT /credential`, `DELETE /credential`, `POST /credential/test`.

Painel: página super admin `/admin/ai` (item de menu só para `isSuperAdmin`): dois interruptores (com regra "pelo menos um"), lista de provedores (tipo, nome, modelo, prioridade, limite diário por tenant, ativo, testar). Tenant: `Configurações → Inteligência artificial`: se `mode=PLATFORM` mostra "Incluída no seu plano"; se `tenantKeysAllowed` e plataforma indisponível, formulário de chave própria (provedor, modelo, chave, testar).

## Parte C — Gerador v2 (`campaigns`)

**Configuração** (`OfferGeneratorConfig` + `OfferDestination`), assistente 1 **Sessão** (sessões conectadas) → 2 **Grupos** (grade de cartões com busca e contador `x/limite`; só grupos da sessão escolhida; limite = entitlement `broadcast_groups`, ausente = sem limite) → 3 **Confirmar** (sessão, total, chips dos grupos, intervalo entre grupos 8–15 s editável) → **Salvar configuração**. `GET/PUT /campaigns/offers/config` (`{ sessionId, intervalMinSeconds, intervalMaxSeconds, conversationIds }`); valida sessão do tenant, grupos da sessão, limite (`PLAN_LIMIT_REACHED`), 5 ≤ min ≤ max ≤ 120.

**Gerar** `POST /campaigns/offers` `{ url, coupon?, audience }`:
- Detecta a loja pelo host (badge "Mercado Livre detectado" no painel, detecção local por host).
- O link colado **é** o link de afiliado (`affiliateUrl = url` normalizada). Não gera mais link.
- Dono do link (após expandir): Amazon `tag` ≠ credencial → `OFFER_LINK_NOT_OWNED` 422; sem `tag` → `OFFER_LINK_NOT_AFFILIATE` 422. ML `matt_word` ≠ credencial → `OFFER_LINK_NOT_OWNED`; sem `matt_word` → `OFFER_LINK_NOT_AFFILIATE`. Shopee: sem verificação (aviso fixo no painel). Sem credencial cadastrada do marketplace → aviso (`attributionVerified=false`), não bloqueia.
- Dados: Shopee pela Open API se houver credencial com secret (`productOfferV2`); senão leitura da página. ML/Amazon: `HttpProductPageReader` (UA de navegador, timeout 8 s, ≤ 2 MB, allowlist): `og:title`, `og:image`, JSON-LD `Product.offers.price`, `product:price:amount`, `andes-money-amount` (ML). Falhou → `needsManualData: true`.
- Texto: `STANDARD` = modelo fixo (sem IA). Outros públicos → `IAiTextGenerator` com prompt por público (Mães: praticidade e carinho; Pet: amor pelo bichinho; Beleza/Moda: autoestima e tendência; Homens: custo-benefício; Fitness: resultado e disciplina; Casa/Cozinha: economia e organização). Texto curto estilo WhatsApp, emojis com moderação, inclui preço, cupom (se houver) e **o link exato**; se a IA omitir o link, anexar. IA indisponível → cai no modelo fixo e devolve `aiFallback: true`.
- `POST /campaigns/offers/:id/regenerate` `{ audience? }` → novo texto (IA; não conta no limite de ofertas; conta no de IA).
- PATCH aceita `coupon`, `audience`, `mentionAll`.

**Enviar**: destinos = grupos da configuração (snapshot no envio); intervalo da configuração; `mentionAll` exige entitlement `mention_all_enabled` ≠ false (ausente = permitido) → menciona todos os participantes do grupo (engine `getGroupParticipants`; JIDs no `mentions` do texto/legenda). Sessão da configuração desconectada → `SESSION_NOT_CONNECTED` 409 antes de enfileirar.

**Painel**: barra de resumo da configuração (sessão + grupos + editar); card "Gerar nova oferta": link (com orientação "Cole o SEU link de afiliado — gere na Shopee, Amazon ou Mercado Livre"), chave "Tem cupom" + código, público-alvo em cartões, "Gerar oferta"; prévia estilo conversa de WhatsApp (foto + texto + horário), "Editar", "Gerar novamente", "Marcar todos os membros", "Será enviada para" (chips), "Disparar nos grupos" com confirmação e progresso.

## Requisitos

| ID | Parte | Requisito |
| --- | --- | --- |
| SESS-01..04 | A | número, nome, QR com contagem, conectado/aviso |
| SESS-05 | A | pareamento por código |
| AI-01..03 | B | settings com invariante; provedores CRUD + teste; chave do tenant |
| AI-04 | B | resolução + limites + log |
| AI-05 | B | adapters Anthropic/OpenAI |
| GEN-01 | C | configuração (sessão, grupos ≤ plano, intervalo) |
| GEN-02 | C | link próprio + verificação de dono |
| GEN-03 | C | dados por API/página com fallback manual |
| GEN-04 | C | cupom + público + IA + gerar novamente |
| GEN-05 | C | marcar todos + envio pelos grupos da configuração |
| GEN-06 | C | painel no fluxo do modelo |
