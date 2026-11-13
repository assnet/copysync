# Extensão ML — Endpoints e Spike (F0)

**Data:** 2026-10-27 · **Status:** ✅ spike validado (local, falta Render)

## 1. Resumo de endpoints

| Endpoint | Método | Auth | Status |
|----------|--------|------|--------|
| `/afiliados/linkbuilder` | GET | `ssid` | ✅ Bootstrap: retorna HTML, Set-Cookie (`_csrf`, `_d2id`, `_mldataSessionId`) |
| `/afiliados/hub` | GET | `ssid` | ✅ Hub principal, CSRF meta tag, sessão ativa |
| `/affiliate-program/api/v2/affiliates/createLink` | POST | `ssid` + `_csrf` + `x-csrf-token` | ✅ Gera link de afiliado |
| `/affiliate-program/api/v2/stripe/user/tags` | GET | `ssid` + `_csrf` + `x-csrf-token` | ✅ Lista etiquetas do afiliado |

## 2. Bootstrap

1. `GET /afiliados/linkbuilder` com `Cookie: ssid=<valor>`
2. Coletar `Set-Cookie`:
   - `_csrf` → valor do CSRF (usar como cookie **e** header `x-csrf-token`)
   - `_d2id` → device ID (opcional, ML gera se ausente)
   - `_mldataSessionId` → session tracking (opcional)
3. Cookie `_csrf` do Set-Cookie tem prioridade sobre o valor do `<meta name="csrf-token">`

**Só `ssid` é suficiente** para autenticar. Demais cookies são derivados no bootstrap.

## 3. createLink

### Request

```
POST /affiliate-program/api/v2/affiliates/createLink
Content-Type: application/json
Cookie: ssid=<ssid>; _csrf=<csrf>
x-csrf-token: <csrf>
Referer: https://www.mercadolivre.com.br/afiliados/linkbuilder
Origin: https://www.mercadolivre.com.br
```

### Body

```json
{
  "urls": ["https://produto.mercadolivre.com.br/MLB-xxx-slug-_JM"],
  "tag": "etiqueta-ativa"
}
```

- `urls`: array de URLs (batch até 20)
- `tag`: **obrigatório** (sem tag → 400 "Invalid values in body object")
- Tag obtida via `/stripe/user/tags` (campo `tag` onde `in_use: true`)

### Response (sucesso)

```json
{
  "status": 200,
  "urls": [{
    "origin_url": "...",
    "short_url": "https://meli.la/xxx",
    "long_url": "https://www.mercadolivre.com.br/sec/xxx",
    "status": 200
  }],
  "total_items": 1,
  "total_success": 1,
  "total_error": 0
}
```

### Response (erro)

```json
{
  "status": 200,
  "urls": [{
    "origin_url": "...",
    "message": "The condition is unknown",
    "error_code": 1008,
    "status": 200
  }],
  "total_items": 1,
  "total_success": 0,
  "total_error": 1
}
```

### Códigos de erro por item

| Código | Mensagem | Causa |
|--------|----------|-------|
| 100 | URL Invalid | URL não reconhecida ou listing não existe |
| 110 | Invalid URL is marketplace home | URL é homepage do ML |
| 1001 | The type must be ITEM, PRODUCT or USER_PRODUCT | URL é de categoria ou outro tipo não-produto |
| 1004 | The article must be active, status: closed | Listing fechada/inativa |
| 1008 | The condition is unknown | Produto sem condição definida ou não elegível |

### Códigos HTTP

| Status | Causa |
|--------|-------|
| 400 | Body inválido (ex: sem `tag`, formato errado) |
| 403 | Sessão expirada ou bloqueada |
| 429 | Rate limit |

## 4. Tags

### Request

```
GET /affiliate-program/api/v2/stripe/user/tags
Cookie: ssid=<ssid>; _csrf=<csrf>
x-csrf-token: <csrf>
```

### Response

```json
{
  "tags": [{
    "tag": "da20250325163608",
    "in_use": true,
    "generated_date": "2026-10-13 18:01:02.587349"
  }]
}
```

### Conta com várias etiquetas (teste real, 2026-11-11)

Conta do dono com 3 etiquetas, chamada feita na própria página do ML:

- `GET /stripe/user/tags` → `200 {"tags":[{tag, in_use, generated_date}, …]}` com **todas** as etiquetas da conta,
  uma só com `in_use: true`. Sem o header `X-Csrf-Token` responde `429 {status, message}` (não é limite real).
- `POST /affiliates/createLink` com `tag` = etiqueta da conta **que não é a `in_use`** → `200`, `short_url` em
  `meli.la` e `long_url` com `matt_word=<essa etiqueta>`. Ou seja, dá para gerar link com qualquer etiqueta da conta.
- `createLink` com etiqueta **que não existe na conta** → `200` e o ML usa a `in_use` em silêncio (`matt_word` da
  principal). O teste antigo (v4, "400 com tag inventada") não se repetiu: não confiar em erro para validar etiqueta.

## 5. Formatos de URL aceitos

| Formato | Aceito | Notas |
|---------|--------|-------|
| `produto.mercadolivre.com.br/MLB-xxx-slug-_JM` | ✅ | Listing — formato preferido |
| `produto.mercadolivre.com.br/MLB-xxx` | ✅ | Listing sem slug |
| `www.mercadolivre.com.br/.../p/MLBxxxxxxxx` | ✅ | Catálogo (precisa slug) |
| `www.mercadolivre.com.br/p/MLBxxxxxxxx` | ✅ | Catálogo curto |
| `www.mercadolivre.com.br/MLB-xxx` | ❌ | 100: URL Invalid |
| `mercadolivre.com.br/...` (sem www) | ❌ | 100: URL Invalid |
| `meli.la/xxx` | ❌ | 100: URL Invalid |
| Homepage | ❌ | 110: marketplace home |
| Categoria | ❌ | 1001: tipo inválido |

## 6. Cookies

### Essenciais (sessão)

| Cookie | Domínio | HttpOnly | Uso |
|--------|---------|----------|-----|
| `ssid` | `.mercadolivre.com.br` | Sim | Sessão principal — **único obrigatório** |
| `_csrf` | `www.mercadolivre.com.br` | Sim | CSRF — obtido no bootstrap |

### Tracking (do bootstrap, opcionais)

| Cookie | Uso |
|--------|-----|
| `_d2id` | Device ID |
| `_mldataSessionId` | Session tracking |

### Rotação

- `nsa_rotok`: JWT de rotação da sessão. Presença indica renovação em curso.
- `Set-Cookie` na resposta do bootstrap e createLink pode atualizar `_mldataSessionId`.
- Servidor deve **merge** Set-Cookie da resposta de volta ao jar antes da próxima chamada.

## 7. Captcha / Anti-bot

- **Páginas de produto e busca**: redirecionam para `/captcha/wall/logged` quando acessadas do servidor com cookies. ML detecta acesso não-browser.
- **Hub de afiliados** (`/afiliados/*`): **NÃO** tem captcha. Funciona do servidor.
- **API de afiliados** (`/affiliate-program/api/v2/*`): **NÃO** tem captcha. Funciona do servidor.
- **API pública ML** (`api.mercadolibre.com`): retorna 403 sem token OAuth.

**Implicação**: dados do produto (título, preço, imagem) **não** podem ser obtidos via scraping da página do servidor. Devem vir da extensão (browser) ou via API OAuth (P6).

## 8. Log de testes executados (Spike v1–v7)

### v1 — Discovery inicial

**Objetivo:** identificar endpoints do hub de afiliados.

| Teste | Resultado |
|-------|-----------|
| `GET /afiliados/hub` com `ssid` | ✅ 200 — HTML do hub, nickname `DA20250325163608` visível |
| `GET /afiliados/linkbuilder` com `ssid` | ✅ 200 — HTML do linkbuilder, Set-Cookie com `_csrf` |
| Extrair CSRF de `<meta name="csrf-token">` | ✅ Valor presente no HTML |

### v2 — Tentativa com endpoints errados

**Objetivo:** testar createLink com base path `/afiliados/api/`.

| Teste | Resultado |
|-------|-----------|
| `POST /afiliados/api/affiliates/createLink` | ❌ 404 — path errado |
| `POST /afiliados/hub/api/affiliates/createLink` | ❌ 404 |
| `POST /afiliados/affiliates/createLink` | ❌ 404 |

**Conclusão:** base path incorreto. ML não usa `/afiliados/api/`.

### v3 — Endpoint discovery via JS bundles

**Objetivo:** extrair endpoints reais dos JS bundles do hub.

| Teste | Resultado |
|-------|-----------|
| Extrair `<script src>` do hub HTML | ✅ Scripts CDN encontrados |
| Analisar JS: buscar `affiliates`, `createLink` | ✅ Encontrado: `/affiliate-program/api/v2/` como base path |
| `POST /affiliate-program/api/v2/affiliates/createLink` | ✅ Aceita (mas body errado ainda) |

**Conclusão:** base path correto: `/affiliate-program/api/v2/`.

### v4 — Endpoints corretos + Tags

**Objetivo:** validar bootstrap → tags → createLink com path correto.

| Teste | Resultado |
|-------|-----------|
| Bootstrap `GET /afiliados/linkbuilder` → CSRF | ✅ `_csrf` via Set-Cookie |
| `GET /affiliate-program/api/v2/stripe/user/tags` | ✅ `{"tags":[{"tag":"da20250325163608","in_use":true}]}` |
| createLink sem tag | ❌ 400 "Invalid values in body object" |
| createLink com tag `COPYSYNC` (inventada) | ❌ 400 — tag não pertence ao usuário |
| createLink com URL `/p/MLB37702498` (inventada) | ❌ 100 "URL Invalid" — produto não existe |
| `api.mercadolibre.com/items/MLB3770249899` | ❌ 403 — precisa OAuth |
| `api.mercadolibre.com/sites/MLB/search` | ❌ 403 — precisa OAuth |

**Conclusão:** tag obrigatória e deve ser etiqueta ativa do usuário. URLs inventadas retornam erro.

### v5 — Formatos de URL + erros detalhados

**Objetivo:** testar vários formatos de URL com tag ativa real.

| Teste | Resultado |
|-------|-----------|
| `/p/MLB1053400152` (iPhone 16 — inventado) | ❌ 100 "URL Invalid" |
| `/p/MLB38040474` (Samsung S24 — inventado) | ❌ 1008 "condition is unknown" |
| `produto.mercadolivre.com.br/MLB-4849770284-..._JM` (inventado) | ❌ 100 "URL Invalid" |
| `mercadolivre.com.br/sec/1VHeLqp` (short link) | ❌ 100 "URL Invalid" |
| `/ofertas` (categoria) | ❌ 1001 "type must be ITEM, PRODUCT or USER_PRODUCT" |
| createLink sem tag (qualquer URL) | ❌ 400 "Invalid values in body object" |
| Batch 3 URLs (mistas) | ✅ 200 — cada item com erro individual |

**Conclusão:** formato da URL importa. IDs inventados não existem no ML. Erro 1008 indica produto existe mas condição indeterminada. Erro 1001 confirma que só aceita produto.

### v6 — Busca de produtos via HTML

**Objetivo:** extrair URLs reais de listings via busca no ML.

| Teste | Resultado |
|-------|-----------|
| `GET lista.mercadolivre.com.br/iphone-16` | ❌ Redirect para captcha (`/captcha/wall/logged`) |
| Busca com `ssid` cookie | ❌ Mesmo redirect — captcha bloqueia busca do servidor |
| URLs `/p/MLBxxxx` fabricadas com IDs populares | ❌ 100 "URL Invalid" — IDs devem corresponder a produtos reais |

**Conclusão:** captcha wall bloqueia busca e páginas de produto do servidor. URLs devem vir do browser (extensão) ou do owner.

### v7 — URLs reais do owner ✅

**Objetivo:** validar createLink com URLs reais fornecidas pelo owner.

| Teste | URL | Resultado |
|-------|-----|-----------|
| Creatina (limpa) | `.../creatina-growth-supplements-.../p/MLB19603205` | ✅ `https://meli.la/1Hb6zu6` |
| Aparador (limpo) | `.../aparador-de-pelos-super-groom-.../p/MLB44784310` | ✅ `https://meli.la/1udB4Ry` |
| Creatina (com query+fragment) | `...?pdp_filters=deal%3A...#polycard_client=affiliates&...` | ✅ `https://meli.la/1Hb6zu6` (mesmo link) |
| Aparador (com query+fragment) | `...?pdp_filters=deal%3A...#polycard_client=affiliates&...` | ✅ `https://meli.la/1udB4Ry` (mesmo link) |
| Batch 2 URLs | ambas acima | ✅ 200, total_items=2, total_success=2, total_error=0 |
| Sem tag | creatina | ❌ 400 "Invalid values in body object" |
| Set-Cookie na resposta | createLink | `_d2id`, `_mldataSessionId` (apenas tracking) |

**Conclusão final:** fluxo completo validado. Query strings e fragments são ignorados (idempotente por produto). Batch funciona. Tag obrigatória.

## 9. Resumo de decisões arquiteturais (derivadas do spike)

| Decisão | Justificativa |
|---------|---------------|
| Extensão captura `ssid` do browser | Único cookie essencial; servidor não consegue login |
| Servidor faz bootstrap + createLink | Hub/API de afiliados não tem captcha |
| Servidor **não** faz scraping de produto | Captcha wall bloqueia páginas de produto/busca |
| Dados do produto vêm da extensão | Browser não tem captcha; extensão envia título/preço/imagem |
| CSRF obtido via bootstrap (Set-Cookie) | Mais confiável que meta tag; renovável |
| Tag vem de `/stripe/user/tags` | Obrigatória; armazenar no `AffiliateCredential` |
| Cookie jar com merge de Set-Cookie | Respostas podem atualizar `_d2id`/`_mldataSessionId` |
| Short URL é idempotente por produto | Mesma URL → mesmo `meli.la` link (pode cachear) |

## 10. Pendências restantes

> 2026-10-28: a implementação do `MercadoLivreAffiliateClient` havia usado `/affiliate-program/link-builder` (404)
> em vez do `/afiliados/linkbuilder` validado aqui. Corrigido na api 0.38.3; ver
> [`incidente-2026-10-28-link-ml.md`](incidente-2026-10-28-link-ml.md).

- [ ] Testar batch de 20 URLs (limite documentado)
- [ ] Testar rotação de CSRF (bootstrap repetido após N minutos)
- [ ] Testar da Render (IP de datacenter vs residencial)
- [ ] Validar se `nsa_rotok` usado no servidor invalida sessão do browser
- [ ] Documentar fixtures para testes unitários
- [ ] Medir TTL da sessão/CSRF
- [ ] Testar rate limit (429) — quantas chamadas/minuto

## 11. Fluxo de integração (extensão → servidor → ML)

```
┌─────────────┐     PUT /ml/session      ┌─────────────┐     Bootstrap + createLink     ┌──────────┐
│  Extensão   │ ──────────────────────► │  CopySync   │ ─────────────────────────────► │    ML    │
│  (browser)  │   cookies: {ssid}        │  API (F1)   │   ssid + _csrf + tag           │  Affil.  │
│             │ ◄────────────────────── │             │ ◄───────────────────────────── │  API v2  │
│  captura    │     200 OK               │  armazena   │     short_url + long_url        │          │
│  ssid do ML │                          │  cifrado    │                                 │          │
└─────────────┘                          └─────────────┘                                 └──────────┘
       │                                        │
       │  Envia título/preço/imagem              │  Gera oferta com link afiliado
       │  (produto extraído do DOM)              │  e dados do produto
       └────────────────────────────────────────►│
```

## 12. Hub de afiliados — busca (2026-11-13)

Fonte do Caçador de Ofertas no ML (`.specs/features/offer-hunter-multi/`, design §1). Captura feita no navegador do
dono (sem clonar perfil do Chrome); fixture reduzida, sem dado pessoal, em
`api/src/modules/campaigns/infrastructure/http/__fixtures__/mlHubSearch.json`.

### Request

```
POST https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop
{"search":"","sort":"relevance","filters":[{"id":"best_seller","value":true}],"offset":0}
```

- `search`: palavra (vazio = sem busca). `sort`: `relevance` | `lowest_price` | `highest_price`.
- `filters`: `{"id":"best_seller","value":true}` (mais vendidos), `{"id":"extra_commission","value":true}` (ganhos
  extras), `{"id":"category","value":"MLB5726"}`. **Suposição**: o valor de `category` é o `id` de
  `filters[category].values[]` da resposta; esse filtro não foi capturado no request.
- `offset`: página × 18 (página 1 = 0). A página do hub manda `x-csrf-token` e `x-custom-origin`; o servidor manda só
  os headers do `createLink` (abaixo) e funciona.

### Response

- `polycard_client_model.polycard_context.picture_template`
  (`https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp`), `picture_square_default` `Q`,
  `picture_size_default` `AB`.
- `polycard_client_model.polycards[]` (18 por página): `metadata.id` (`MLB\d+`, anúncio), `metadata.product_id`,
  `metadata.url`, `metadata.extra_commission`/`brand_commission` (string `"true"`/`"false"`); `pictures.pictures[0].id`;
  `components[]` por `id`: `title`, `price` (`current_price.value`, `previous_price.value`, `discount_label`),
  `review_compacted` (`values[label].label.text` = nota; `alt_text` "Classificação 4.9 de 5 estrelas. Mais de 100
  produtos vendidos."), `highlight` ("MAIS VENDIDO") e **`affiliates_commission_chip`**: pill simples
  `"GANHOS 12%"` ou composite `"{ganancia} {extra}"` → "GANHOS EXTRAS" com o percentual em `chip.label.text` ("17%").
  Patrocinado por marca (`brand_commission` `"true"`) também vem como "GANHOS EXTRAS".
- `filters`: `category` (25 categorias raiz `{id, name}`), `extra_commission`, `best_seller`; `sort`,
  `available_sorts`; `next_offset` (ausente = última página).
- Comissão vem por cartão (percentual já com o extra); a tabela oficial por categoria
  (`mercadoLivreCommissionTable.ts`, leitura 2026-11-06) só estima quando o chip falta (`commissionEstimated`).

### Sonda da Render (aprovada 2026-11-13)

Bootstrap `GET /afiliados/linkbuilder` com só o `ssid` → 200 com `_csrf`; `POST /affiliate-program/api/hub/search` →
200 com 18 cartões em "mais vendidos", "ganhos extras" e busca "vestido" (45–51 KB). Headers iguais aos do
`createLink`: `User-Agent` fixo, `Accept: application/json`, `Content-Type: application/json`,
`Origin: https://www.mercadolivre.com.br`, `Referer: https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true`,
`X-Requested-With: XMLHttpRequest`, `X-Csrf-Token: <_csrf>`, `Cookie` (sessão + bootstrap). curl sem esses headers
toma 403 do WAF em `GET /afiliados/hub`.

### Implementação

- Bootstrap compartilhado: `campaigns/infrastructure/http/mercadoLivreBootstrap.ts` (`createLink`/tags e hub).
- Cliente: `MercadoLivreHubClient` (`IHuntCatalogSource`); mapeador puro `domain/services/hunter/mercadoLivreHubMapper.ts`;
  capacidades `mercadoLivreCapabilities.ts`; adaptador `infrastructure/hunter/providers/mercadoLivreHuntAdapter.ts`
  (URL do produto `https://produto.mercadolivre.com.br/MLB-<dígitos>`).
- `redirect: 'manual'`, timeout 8 s, corpo ≤ 256 KiB. Erros: redirect para login ou 401 = sessão recusada; **403 sem
  redirect (WAF), inclusive no bootstrap do hub, = fonte indisponível** (não pausa a credencial; no `createLink` o
  403 do bootstrap segue = recusada); 429 = rate limit; formato inesperado = indisponível. Foto só https
  `*.mlstatic.com`. Cookie/token nunca em log, erro ou resposta.

### Não fazer

- Não mandar `x-custom-origin` nem outro header de navegador além dos acima sem nova sonda da Render.
- Não ler página de produto para achar comissão; não clonar perfil do Chrome para sondar.
- Não clicar em nada no hub durante captura: um clique abriu o centro de notificações e marcou notificações como lidas.
