# Gerador de ofertas — Specification

Item 8 do roadmap (`docs/produto-roadmap.md`), marco M1-P de `docs/plano-lancamento-hub-copysync.md`.
Módulo `api/src/modules/campaigns/` (sub-recurso `offer-generator`). Decisões do owner em `context.md`.

## Problem Statement

O afiliado perde tempo montando oferta à mão: abre o produto, copia título e preço, baixa a foto, gera
o link no painel do marketplace e cola em cada grupo. As credenciais de afiliado já estão guardadas
(`integrations/affiliate-credentials`), mas nada as usa. O gerador fecha esse ciclo: colar o link,
revisar a oferta pronta e enviá-la aos destinos já escolhidos.

## Goals

- [ ] Link da Shopee vira oferta completa (foto, título, preço, desconto, link curto de afiliado) sem digitação
- [ ] Link da Amazon e do Mercado Livre vira link de afiliado do tenant; dados do produto preenchidos pelo operador
- [ ] Oferta revisada sai como imagem + legenda (ou texto) para os destinos pré-selecionados, com intervalo entre envios
- [ ] Toda oferta fica gravada (`Offer`) e conta para o limite diário `offer_generations_per_day`
- [ ] Zero marca no código; i18n via `strings.ts`; claro/escuro/sistema

## Out of Scope

| Item | Motivo |
| --- | --- |
| Espelhamento grupo-fonte → destinos ("Disparo em massa") | Feature própria, item 10: `.specs/features/broadcast-mirror/context.md` |
| Grupos de disparo como cadastro compartilhado (item 5) | Destinos do gerador são uma lista própria; unificar quando o item 5 existir |
| Horário de postagem / agendamento (item 6) | M2; aqui o envio é imediato, só espaçado |
| Dados automáticos de ML e Amazon | Scraping bloqueado de datacenter (403/500/captcha); PA-API 5 descontinuada; Creators API exige 10 vendas/30 dias. P3: extensão lê o DOM; Creators API por tenant elegível |
| Link ML pelo endpoint interno com sessão da extensão | Sem documentação, frágil (ToS, cookie). Avaliar com captura real de tráfego (P3) |
| Reescrita com IA (item 7) | `assistants/offer-rewriter`; o texto aqui vem de modelo fixo editável |
| Modelos de texto salvos por tenant | P2 (`OFFER-12`) |
| Story, site de ofertas, rodízio | Itens 9, 11, 12 |
| Bloquear o gerador no Starter | Enforcement de "recurso por plano" é M3 (trilha B). Aqui só o limite diário |

---

## User Stories

### P1: Gerar oferta a partir do link ⭐ MVP

**User Story**: Como afiliado, quero colar o link de um produto e receber a oferta montada com o meu link,
para não montar nada à mão.

**Acceptance Criteria**:

1. WHEN o operador envia uma URL de `shopee.com.br`, `s.shopee.com.br`, `shope.ee`, `mercadolivre.com.br`,
   `mercadolivre.com`, `mercadolibre.com`, `amazon.com.br` ou `amzn.to` THEN o sistema SHALL identificar o marketplace pelo host
2. WHEN a URL é encurtada THEN o sistema SHALL seguir até 5 redirecionamentos, cada salto restrito à allowlist de hosts do marketplace, com timeout de 8 s no total
3. WHEN o host não está na allowlist (inclusive após redirecionar) THEN o sistema SHALL responder `OFFER_URL_UNSUPPORTED` (422) sem fazer nenhuma requisição a ele
4. WHEN o marketplace é Shopee e há credencial ativa THEN o sistema SHALL buscar o produto (`productOfferV2` por `shopId`+`itemId`) e gerar o link curto (`generateShortLink`) pela Affiliate Open API
5. WHEN o marketplace é Amazon THEN o sistema SHALL montar `https://www.amazon.com.br/dp/{ASIN}?tag={trackingId}`, descartando outros parâmetros
6. WHEN o marketplace é Mercado Livre THEN o sistema SHALL devolver a URL canônica do produto com `matt_word={etiqueta}`, sem outros parâmetros de rastreio, e marcar `attributionVerified: false`
7. WHEN Amazon ou ML THEN a resposta SHALL vir com `product` vazio (`title`, `price`, `imageUrl` nulos) e `needsManualData: true`
8. WHEN não há credencial ativa do marketplace THEN o sistema SHALL responder `AFFILIATE_CREDENTIAL_NOT_FOUND` (404) e o painel SHALL apontar para `/settings/affiliate-credentials`
9. WHEN a geração termina THEN o sistema SHALL gravar uma `Offer` em `DRAFT` e devolvê-la

**Independent Test**: com credencial Shopee de teste, colar `https://shopee.com.br/x-i.123.456` e ver foto, título, preço e `shopee` short link.

### P1: Revisar e editar a oferta ⭐ MVP

**User Story**: Como afiliado, quero ajustar título, preço, foto e texto antes de enviar.

**Acceptance Criteria**:

1. WHEN a oferta é gerada THEN o painel SHALL mostrar a prévia (foto, título, preço de/por, desconto) e o texto montado pelo modelo padrão
2. WHEN o operador altera título, preço, preço original, foto ou texto THEN o sistema SHALL salvar na `Offer` (`PATCH`)
3. WHEN o operador troca a foto THEN o upload SHALL usar `chunkedUpload`, e só imagem é aceita (`UNSUPPORTED_MEDIA_TYPE` 415 senão)
4. WHEN o texto não contém o link de afiliado THEN o painel SHALL avisar antes de enviar (não bloqueia)
5. WHEN o preço muda THEN o texto SHALL ser remontado só se o operador ainda não editou o texto à mão

**Independent Test**: gerar oferta Amazon, preencher título/preço, subir foto, ver prévia e texto atualizados.

### P1: Destinos pré-selecionados ⭐ MVP

**User Story**: Como afiliado, quero escolher uma vez os grupos/conversas que recebem minhas ofertas.

**Acceptance Criteria**:

1. WHEN o operador abre "Destinos" THEN o painel SHALL listar conversas de todas as sessões do tenant, com filtro "só grupos", e marcar as já selecionadas
2. WHEN o operador salva a seleção THEN o sistema SHALL substituir a lista (`PUT`), validando que cada conversa pertence ao tenant
3. WHEN uma conversa selecionada some ou a sessão dela é removida THEN o envio SHALL marcar aquele destino `SKIPPED` e seguir com os outros

### P1: Enviar a oferta ⭐ MVP

**User Story**: Como afiliado, quero enviar a oferta revisada a todos os destinos sem disparar em rajada.

**Acceptance Criteria**:

1. WHEN o operador confirma o envio THEN o sistema SHALL criar um `OfferDispatch` por destino em `QUEUED`, com `notBefore` espaçado pelo intervalo configurado (padrão aleatório entre 8 e 15 s), e marcar a `Offer` como `SENDING`
2. WHEN chega o `notBefore` THEN o worker SHALL enviar imagem + legenda (ou só texto, se não há foto) pela sessão da conversa, reaproveitando o fluxo `PENDING` do chat, e gravar `chatMessageId`
3. WHEN o envio de um destino falha THEN só ele SHALL ficar `FAILED` com motivo interno; os outros continuam
4. WHEN todos os destinos terminam THEN a `Offer` SHALL ir para `SENT` (ao menos um enviado) ou `FAILED` (nenhum)
5. WHEN a API reinicia no meio do envio THEN os `QUEUED` SHALL continuar depois do boot (estado no banco, não em memória)
6. WHEN não há destinos THEN o envio SHALL responder `OFFER_NO_DESTINATIONS` (422)
7. WHEN a sessão do destino não está conectada THEN o destino SHALL ficar `FAILED` com `SESSION_NOT_CONNECTED`
8. WHEN a oferta já está `SENDING` ou `SENT` THEN novo envio SHALL responder `OFFER_ALREADY_SENT` (409)

**Independent Test**: dois grupos de teste como destino, enviar, ver as duas mensagens chegarem com ~8–15 s de diferença.

### P1: Limite diário por plano ⭐ MVP

**Acceptance Criteria**:

1. WHEN o tenant tem `offer_generations_per_day = N` e já gerou N ofertas no dia (fuso `America/Sao_Paulo`) THEN gerar SHALL responder `PLAN_LIMIT_REACHED` (403) com `meta { key, limit }`
2. WHEN o entitlement não existe ou é `null` THEN o limite SHALL ser ilimitado
3. WHEN o limite é atingido THEN o painel SHALL mostrar o motivo e quantas restam no dia (`GET` de uso)

### P2: Histórico de ofertas

1. WHEN o operador abre o histórico THEN o painel SHALL listar ofertas paginadas por cursor assinado (`OpaqueCursor`), mais recentes primeiro, com status por destino
2. WHEN o operador escolhe "reenviar" numa oferta `SENT`/`FAILED` THEN o sistema SHALL criar uma nova `Offer` copiada (conta no limite)

### P2: Intervalo configurável

1. WHEN o operador ajusta o intervalo (mín. 5 s, máx. 120 s, faixa aleatória) THEN o sistema SHALL guardar por tenant e usar nos próximos envios

### P2: Modelos de texto (`OFFER-12`)

1. WHEN o operador salva um modelo com marcadores `{titulo}`, `{preco}`, `{preco_original}`, `{desconto}`, `{link}` THEN o gerador SHALL usá-lo como padrão do tenant

---

## Edge Cases

- WHEN a Shopee responde `10035` (sem acesso à Open API) THEN `AFFILIATE_API_ACCESS_DENIED` (422) com orientação de liberar o acesso no painel de afiliado
- WHEN a Shopee responde `10020`/assinatura inválida THEN `AFFILIATE_CREDENTIAL_REJECTED` (422) e o painel aponta para editar a credencial
- WHEN a Shopee responde `10030`/HTTP 429 THEN `AFFILIATE_API_RATE_LIMITED` (429)
- WHEN a Shopee não acha o produto THEN `OFFER_PRODUCT_NOT_FOUND` (404)
- WHEN a API do marketplace demora > 8 s ou cai THEN `AFFILIATE_API_UNAVAILABLE` (503); nenhuma `Offer` é gravada nem conta no limite
- WHEN a foto da Shopee não baixa THEN a oferta é gravada sem foto e o painel pede outra
- WHEN a URL tem credenciais (`user:pass@`), porta, IP ou esquema ≠ `https` THEN `OFFER_URL_UNSUPPORTED`
- WHEN o texto passa de 4.096 caracteres THEN 422 na edição
- WHEN o mesmo link é colado duas vezes THEN são duas ofertas (sem dedupe; o operador pode querer textos diferentes)

---

## Requirement Traceability

| ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OFFER-01 | P1 Gerar: detectar marketplace + allowlist + redirects (SSRF) | Design | Pending |
| OFFER-02 | P1 Gerar: Shopee produto + link curto | Design | Pending |
| OFFER-03 | P1 Gerar: Amazon link com tag | Design | Pending |
| OFFER-04 | P1 Gerar: ML link com `matt_word` | Design | Pending |
| OFFER-05 | P1 Gerar: persistir `Offer` DRAFT | Design | Pending |
| OFFER-06 | P1 Revisar: PATCH + foto por upload + texto por modelo | Design | Pending |
| OFFER-07 | P1 Destinos: listar/salvar | Design | Pending |
| OFFER-08 | P1 Enviar: `OfferDispatch` + worker durável espaçado | Design | Pending |
| OFFER-09 | P1 Limite diário por entitlement | Design | Pending |
| OFFER-10 | P1 Painel: tela do gerador (i18n, temas, tooltips) | Design | Pending |
| OFFER-11 | P2 Histórico + reenviar | - | Pending |
| OFFER-12 | P2 Modelos de texto | - | Pending |
| OFFER-13 | P2 Intervalo configurável por tenant | - | Pending |

**Coverage:** 13 total, 0 mapeados para tasks.

## Success Criteria

- [ ] Oferta Shopee de link colado a enviada em < 30 s de interação
- [ ] Nenhum segredo de afiliado em log, resposta ou `meta`
- [ ] Restart da API durante envio não perde nem duplica destino
