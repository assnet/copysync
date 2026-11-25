# Afiliado Kabum

Kabum é a 5ª loja do gerador, do monitoramento, da vitrine e do story, pelo caminho único
(`ResolveAffiliateProductUseCase` / `BuildTenantAffiliateLinkUseCase`). Entrou em api 0.105.0 · app 0.128.0, **visível só
para super admin** (audiência) e só no plano MAX. Specs: `.specs/features/affiliate-marketplaces-expansion/`
(`research`, `spec` KBM-01..06 e MKT-01..11, `design`, `tasks` F1). Roadmap: [`produto-roadmap.md`](produto-roadmap.md).
Outras lojas avaliadas: [`marketplaces-pesquisa.md`](marketplaces-pesquisa.md). Extensão: nenhuma mudança.

## Programa

- Rede **Awin**, anunciante "Kabum BR" **ID 17729** (`KABUM_AWIN_ADVERTISER`). Cadastro e aprovação pela Awin.
- Comissão CPA 2,30 % (venda própria/1P e 2P), 1,15 % (vendedor parceiro/3P). Prime Ninja e gift card não pagam.
- Cookie de **1 dia**, só a compra na mesma sessão do último clique.
- Proibido: cupom que não veio da Awin, search (direto/indireto), retargeting.
- Preço "De/Por" exige a frase "Oferta válida enquanto durarem os estoques" (o texto da oferta **não** a põe sozinho:
  fora de escopo).
- O card mostra essas regras (`settings/strings.ts` → `programRules.KABUM`, KBM-06).

## Credencial

`affiliate_credentials` (KABUM): `publicIdentifier` = **Publisher ID da Awin** (`^\d{4,10}$`), sem segredo, sem
extensão. Ver [`integracoes-credenciais-afiliado.md`](integracoes-credenciais-afiliado.md).

## Link

Montado no servidor, sem rede (`campaigns/domain/services/kabumAffiliateUrl.ts`):

```
https://www.awin1.com/cread.php?awinmid=17729&awinaffid=<Publisher ID>&ued=<https://www.kabum.com.br/produto/<id> codificada>
```

- URL canônica = `https://www.kabum.com.br/produto/<id>` (sem slug: o slug colado vem de terceiro).
- Aceitos (`detectMarketplace`/`parseProductRef`): `kabum.com.br/produto/<id>[/slug]` e `awin1.com/cread.php` **só**
  com `awinmid=17729` e `ued` em `kabum.com.br` (destino lido do parâmetro, sem rede). `awin1.com` de outro anunciante
  = não suportado, decidido **na detecção** (antes de plano e credencial): senão link Awin de terceiro virava
  `plan_unavailable`/`credential_missing` e derrubava a captura inteira.
- `awinaffid` = Publisher ID do tenant → link dele, mantido (exceção à regra "só mantém link curto" de
  `shouldKeepPastedLink`); outro afiliado → recriado.
- **`tidd.ly` fica fora** (não suportado, como antes): é o encurtador de toda a rede Awin; sem expandir não se sabe o
  anunciante e o monitor checa o plano antes de expandir. Aceitá-lo faria `tidd.ly` de qualquer anunciante cair em
  KABUM. `awin1.com` e `tidd.ly` **não** entram em `isShortLink`. API Awin (`linkbuilder`, token, 20 req/min): adiada.

## Produto

`KabumCatalogClient` (porta `IKabumCatalogClient`, `campaigns/infrastructure/http/`):
`GET https://servicespub.prod.api.aws.grupokabum.com.br/catalog/v2/products/<id>` (pública, sem cookie). URL em
constante, só `https`, timeout 8 s, corpo ≤ 256 KiB, `redirect: 'manual'`.

- Campos dentro de `{type, id, attributes}`. Preço em destaque = `offer.price_with_discount` com **oferta ativa**
  (`starts_at ≤ agora < ends_at`, `quantity_available > 0`, `is_logged_user_exclusive ≠ true`), senão
  `price_with_discount` (à vista/PIX, sem rótulo "no Pix"), senão `price`. Original = `old_price` só se maior.
- Indisponível → `null` (erro de produto). 404 (`CATALOG_NOT_MATCH`) → `null`. 3xx, 5xx, timeout, JSON inválido,
  corpo grande → `AffiliateApiUnavailableError`.
- Foto: `images.kabum.com.br` (allowlist do `HttpOfferImageFetcher`), forçada para `https`, gravada no storage.
- `HttpProductPageReader` devolve `null` sem rede para KABUM (a página não é lida).

## Audiência e plano

- Chave `marketplace_kabum_enabled`: LITE/PRO `false`, MAX `true`, ausente = bloqueado; editável em
  `/admin/plan-entitlements`.
- Flag "Só super admin" (`platform_settings.feature_audience`, valor inicial `true` em código, sem env), coluna da mesma
  tela, lida a cada pedido (`MarketplaceAudienceGate` sobre `FeatureAudienceGate`).
- Flag ligada, usuário comum: loja **invisível** — sem card, sem item na assinatura, sem alerta de credencial; link
  colado = `OFFER_URL_UNSUPPORTED` antes de qualquer rede; rotas de credencial = 400 de provider inexistente.
  Monitoramento (`caller: background`): só processa com plano **e** credencial, senão `unsupported`, sem alerta novo.
- Flag desligada: vale o plano (`PLAN_FEATURE_UNAVAILABLE`, selo, `plan_unavailable`), como a Shein.
- Religar a flag não para o monitoramento de quem já conectou: corte real = desligar a chave do plano.
- Liberar (T24): desligar a flag, incluir a Kabum em `app/src/features/plans/catalog.ts`, tirá-la do filtro do
  `PlansHero.tsx` e pôr os hosts em `features/offers/utils/offerStore.ts`.

## Migrations

`20261124090000_add_kabum_affiliate_provider` · `…090300_add_marketplace_expansion_entitlements` (presets + backfill
`ON CONFLICT DO NOTHING`). Rodam no boot da Render; nunca local.

## Pendências

- T0/T0-KBM (dono): catálogo a partir da Render; deep link aceito no 17729 e clique no painel Awin; T12 smoke.
- Termos da Awin/Kabum sobre automação e WhatsApp não lidos por inteiro (T0b).

## O que não fazer

- Aceitar `awin1.com` de anunciante ≠ 17729, `ued` fora de `kabum.com.br`, ou `tidd.ly`.
- Requisitar `awin1.com`/`ued` para descobrir o destino (é lido da query).
- Devolver link colado de outro afiliado ou montar link sem o Publisher ID do tenant.
- Ler a página `kabum.com.br/produto` (reserva só se o catálogo sumir; decisão do dono).
- Pôr "no Pix" ou a frase de estoque no texto sem decisão do dono.
- Anunciar a Kabum em `/plans` ou responder 403 de plano com a flag "Só super admin" ligada.
- Guardar resposta do catálogo em memória do processo.
