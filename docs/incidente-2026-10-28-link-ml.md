# Incidente 2026-10-28 — oferta ML capturada, link do tenant nunca gerado

Registro de diagnóstico e correção (api 0.38.3). Serve de guia para o próximo que mexer em
`MercadoLivreAffiliateClient`, `BuildTenantAffiliateLinkUseCase` ou no monitoramento de grupos.

## 1. Sintoma

Monitoramento ligado na sessão `BusinessAdr` (tenant super admin), só credencial Mercado Livre.
Oferta ML postada no grupo monitorado "Top ofertas" (16:43 BRT) não apareceu em "Ofertas capturadas".

## 2. Diagnóstico (ordem real)

| Passo | Evidência (banco, somente leitura) | Conclusão |
|---|---|---|
| 1 | `captured_offers` com **0 linhas** desde sempre; `chat_messages` do grupo tinha 3 mensagens com link e foto após o grupo ser monitorado | Mensagens chegaram; o listener nunca gravou |
| 2 | Código: listener só é registrado com `GROUP_MONITORING_ENABLED=true` (`server.ts`); default `false`; `render.yaml` não declara env da API | Flag ausente na Render. Owner ligou a flag → API reiniciou |
| 3 | Primeira captura (19:52 UTC): `FAILED / LINK_RESOLVE_FAILED`, marketplace `MERCADO_LIVRE`, 3 s de processamento | Captura OK; falha ao gerar o link do tenant |
| 4 | Teste local de `extractUrls`, `matchesKeywords`, `rewriteOfferLinks` e rede de segurança com o texto real | Regras puras passam; descartadas |
| 5 | `meli.la/32vQxjM` → `/social/<etiqueta>?…&ref=…`; página responde 200 e o 1º card é o produto certo (`product_id` `MLB44022021`, item `MLB4886745619`, URL `…/p/MLB44022021`) | `product_id` da vitrine é **catálogo**; código montava `produto…/MLB-44022021` (não existe) |
| 6 | `curl` em `/affiliate-program/link-builder` → **404**; `/afiliados/linkbuilder` → 302 para login (sem sessão) | Bootstrap do cliente apontava para rota inexistente |
| 7 | `offers`: 0 de 21 ofertas ML com `affiliateUrl ≠ sourceUrl` | `createAffiliateLinks` nunca funcionou em produção; gerador só reaproveitava link do operador |
| 8 | `docs/extensao-ml-endpoints.md` (spike v1–v7 com cookies reais, 27/10) e `legadoML/geralink…/gerar-link.ts` | Spike validou `/afiliados/linkbuilder` + `Referer`/`Origin`; a implementação desviou e a doc do gerador copiou o desvio |

Segunda captura (20:02 UTC) foi Shopee → `SKIPPED / CREDENTIAL_MISSING`: esperado, tenant sem credencial Shopee.

Não confirmado (sem acesso ao log da Render): qual dos dois erros a ML devolveu primeiro (403 por falta
de `_csrf` ou 100 pela URL). Os dois estavam presentes e os dois foram corrigidos.

## 3. Como estava → como ficou → por quê

### 3.1 `MercadoLivreAffiliateClient.ts`

| | Antes | Depois | Por quê |
|---|---|---|---|
| Bootstrap | `GET /affiliate-program/link-builder`, `redirect: manual`, só 401/403 derrubava | `GET /afiliados/linkbuilder`; redirect manual até 3 saltos, Set-Cookie de cada salto mesclado no jar; redirect para fora de `/afiliados/` (login `mercadolivre.com/jms/…`) = `AFFILIATE_CREDENTIAL_REJECTED`; não-2xx = `AFFILIATE_API_UNAVAILABLE`; aviso se faltar `_csrf` | Rota antiga responde 404 sem `_csrf`; 404 não era tratado, seguia sem CSRF e o `createLink` recusava. Spike e geralink usam `/afiliados/linkbuilder` |
| Headers `createLink` | `Accept`, `Content-Type`, `Cookie`, `X-Csrf-Token` | + `Origin`, `Referer: /afiliados/linkbuilder`, `X-Requested-With` | Spike §3 e geralink enviam; checagem CSRF da ML olha `Referer`/`Origin` |
| Headers `tags` | `Accept`, `Cookie`, `X-Csrf-Token` | + `Referer` | idem |
| Etiqueta | `publicIdentifier` do tenant, fallback na etiqueta ativa | **mantido** | Spike v4: `da20250325163608` é a etiqueta `in_use` da conta; estava certo |
| Cookies sincronizados | só `ssid` (+ `org*`) | **mantido** | Spike §6: só `ssid` é essencial; `_csrf`/`_d2id` vêm do bootstrap |

### 3.2 `BuildTenantAffiliateLinkUseCase.ts`

| | Antes | Depois | Por quê |
|---|---|---|---|
| Vitrine social | `product_id` → `catalog: false` → `https://produto.mercadolivre.com.br/MLB-<id>` | `catalog: true` → `https://www.mercadolivre.com.br/p/<id>` | `product_id` é id de catálogo (card tem `url: …/p/MLB…`); forma de item com id de catálogo não existe (ML 100 URL Invalid). Spike §5 aceita `/p/MLBxxx` |
| Leitura da vitrine | com `ssid` do tenant | sem cookie | Spike §7: página com cookie do servidor cai em `/captcha/wall/logged`; vitrine é pública (200 anônimo nos testes) |
| ML recusa o item | `code: AFFILIATE_LINK_NOT_CREATED`, sem log | `code: ML_<error_code>` (100/1001/1004/1008) + `logger.warn` | Diagnóstico sem log de infra; o código da ML diz se é URL, tipo, anúncio fechado ou condição |

### 3.3 `HttpProductPageReader.ts`

`sendsMlCookie` deixa de incluir `/social/`. Mesmo motivo do captcha. Teste ajustado.

### 3.4 `ProcessPendingCapturedOffersUseCase.ts`

Ao receber `failed` do `ITenantLinkBuilder`, loga `capturedOfferId`, `tenantId`, `marketplace` e
`code`. `reason` segue `LINK_RESOLVE_FAILED` (o painel mapeia por `reason`; guardar o código no banco
pede migration e tela, fica para depois).

### 3.5 Documentação

`docs/gerador-de-ofertas.md` tinha o path errado copiado da implementação; corrigido. `docs/monitoramento-grupos.md`
§2.1 explica catálogo × item na vitrine e leitura sem cookie.

## 4. O que não mudou (e por quê)

- `GROUP_MONITORING_ENABLED` continua flag de ambiente, ligada só na Render (AGENTS §22). Não há env
  para o path do Link Builder: é constante de código.
- Sem migration: nada de coluna nova em `captured_offers`.
- Sem teste de integração contra a ML (cookies reais, IP de datacenter). Pendência §10 do spike
  "Testar da Render" continua aberta: se a ML bloquear IP de datacenter, o log mostrará
  `AFFILIATE_CREDENTIAL_REJECTED` no bootstrap mesmo com sessão válida.

## 5. Como validar depois do deploy

1. Painel → Monitoramento → captura `cmvsj6uce002afh0tbinjnjg9` → "Tentar de novo" (ou esperar a
   próxima oferta ML no grupo).
2. Esperado: `QUEUED` com `affiliateUrl` `meli.la/…` do tenant. Se `FAILED`, log da Render em
   `captured offer link not built` traz o `code`:
   - `AFFILIATE_CREDENTIAL_REJECTED` → sessão expirada ou bloqueio de IP: ressincronizar pela extensão;
   - `ML_100` → URL ainda inválida (checar a URL montada);
   - `ML_1008`/`ML_1004` → produto não elegível, nada a corrigir no código.

## 6. O que não fazer

- Trocar o path do bootstrap sem rodar o spike de `docs/extensao-ml-endpoints.md` de novo.
- Mandar `produto.mercadolivre.com.br/MLB-<product_id>` para a ML: `product_id` ≠ id de item.
- Ler página da ML com cookie do servidor fora de `/afiliados/*` e `/affiliate-program/api/*`.
- Confiar só no HTTP 200 do `createLink`: o erro vem por item em `error_code`.
