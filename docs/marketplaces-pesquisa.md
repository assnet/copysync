# Marketplaces: pesquisa e estado

Lojas avaliadas em 2026-11-24 (`.specs/features/affiliate-marketplaces-expansion/research.md`). Testes de IP
residencial brasileiro; **nada testado a partir da Render**. Kabum já entrou: [`afiliado-kabum.md`](afiliado-kabum.md).

| Loja | Programa | Estado |
|---|---|---|
| Kabum | Awin 17729 | Implementada (api 0.105.0), só super admin |
| Magalu | Influenciador Magalu (`magazinevoce.com.br`) | Planejada (F2); enum, chave e regras puras prontos, sem cliente |
| AliExpress | Portals + Affiliate API oficial | Planejada (F3); enum, chave, regras puras e credencial prontos, sem cliente |
| Pichau | Próprio (Pichau Creator Network) | Só documentada |
| Netshoes | Rakuten Advertising (white label) | Só documentada |

## Magalu e AliExpress (planejadas)

Já existe: valores `MAGALU`/`ALIEXPRESS` no `AffiliateProvider`, chaves `marketplace_magalu_enabled` e
`marketplace_aliexpress_enabled` (só MAX) com flag "Só super admin", detecção/`parseProductRef`/`verifyAffiliateLink`
e campos de credencial (Magalu: slug da loja, aceita a URL colada; AliExpress: Tracking ID + `appKey:appSecret`
cifrado). O composer ainda lança `OfferUrlUnsupportedError` para as duas: link colado segue "não suportado" e não há
card no painel.

Portões F0 pendentes (dono):

- **T0** sonda na Render: vitrine `magazinevoce` (HTML com `Accept-Language` e `/_next/data/`), CDN
  `a-static.mlcdn.com.br`, `api-sg.aliexpress.com/sync`.
- **T0-MGL** loja do dono: formato do slug, venda atribuída pelo link `magazinevoce/{slug}/…`, links curtos
  (`onelink.me`, `divulgador.magalu.com`).
- **T0-ALI** conta Portals + app "Affiliates API" do próprio cliente (app da plataforma não serve: `tracking_id` de
  outra conta é ignorado); formato das chaves, erros de produto sem comissão e de frequência. Bloqueia só a F3.

Magalu: o servidor **nunca** requisita `magazineluiza.com.br`/`federation.*` (403 Akamai); desafio
(`/az-request-verify`, 403) = loja indisponível.

## Pichau

- Programa próprio, cadastro com análise manual (3–5 dias úteis), exige 18+, CPF/CNPJ, 2FA na conta da loja e canal
  público. Comissão sem percentual público, last-click.
- WhatsApp/Telegram só nos canais informados e aprovados no cadastro; proíbe mensagem privada em massa.
- Sem API pública; gerador de deep link e encurtador só no painel `/admin/`. **Formato do link desconhecido.**
- Produto: GraphQL `www.pichau.com.br/api/pichau` (Magento), mas Cloudflare devolve 403 até a navegador real e o
  `robots.txt` proíbe `/api/`.
- **Falta para integrar**: um link real gerado por afiliado aprovado (tag na URL ou token do painel); leitura do
  produto sem contornar o Cloudflare; confirmar se grupos arbitrários cabem na regra de canais aprovados.

## Netshoes

- Portal `netshoes.rmaffiliate.com` = white label da Rakuten Advertising; comissão "até 13 %" (terceiros); contrato
  genérico, sem regra de WhatsApp/Telegram nem janela de cookie.
- API Rakuten oficial (`api.linksynergy.com`): token por `client_id:client_secret` + SID (3600 s, 100 req/min), deep
  link `POST /v1/links/deep_links` `{url, advertiser_id, u1?}`, Product Search em XML (sem PIX nem estoque).
  Link determinístico (fonte terceira): `click.linksynergy.com/deeplink?id=<11>&mid=<MID>&murl=<URL>`.
- Site atrás da Akamai (403 a curl e headless).
- **Falta para integrar**: MID da Netshoes Brasil (só no painel logado); acesso do white label ao portal de
  desenvolvedor; cobertura da Product Search para a Netshoes (senão não há dado de produto pelo servidor); regra
  sobre WhatsApp/Telegram; conflito de fonte que cita Awin em 2026.

## O que não fazer

- Contornar proteção: captcha, stealth, proxy, User-Agent de crawler (Googlebot), cookie de usuário, Wayback.
- Scraper pago de terceiro (é contornar a proteção por outro).
- App AliExpress da plataforma para gerar link de cliente.
- Integrar Pichau ou Netshoes sem os itens "falta para integrar" e sem decisão do dono.
- Mexer na extensão para essas lojas (decisão do dono: navegador fechado).
