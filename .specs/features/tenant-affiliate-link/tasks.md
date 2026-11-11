# Link de afiliado sempre do tenant — Tasks

**Spec**: `spec.md` · **Design**: `design.md`
**Branch**: `feature/tenant-affiliate-link` a partir de `feature/rebranding-app` (volta para ela), criada **depois** do merge da FH e, de preferência, da FE (as duas mexem no `ResolveAffiliateProductUseCase`).
**Commits**: `tipo(escopo): descrição`. Cada task fecha com o gate indicado.
**Gates** (`.specs/codebase/TESTING.md`): `quick` = `pnpm test` no app tocado · `full` = `pnpm typecheck && pnpm test` em `api/` e `app/`.
**`[P]`** = pode rodar em paralelo com as outras `[P]` da mesma fase (só testes unitários; nada de banco).
**Subagentes**: no máximo 3 ao mesmo tempo, RAM livre ≥ 20 % (monitor `memory_pressure`).
**Banco**: só a TE2 cria migration (aplicada pela Render no boot). Nenhuma task roda SQL em produção. `api/.env` aponta para produção: não rodar `start:migrate`/`prisma:deploy`.

## FH — Correção imediata (não depende de D1–D3)

Branch própria `fix/ml-own-link-social-handle` a partir de `feature/rebranding-app`; volta para ela e pode ir a
produção sozinha. O resto do plano parte dela.

### TH1: `matt_word` tem precedência sobre `/social/<apelido>`

**O quê**: função pura `ownershipIdentifiersOf(provider, urls)`; `verifyAffiliateLink` usa ela. ML: com qualquer
`matt_word`, ignora `/social/<x>`; sem nenhum, usa `/social/<x>` como hoje.
**Onde**: `api/src/modules/campaigns/domain/services/verifyAffiliateLink.ts` + `verifyAffiliateLink.test.ts`;
casos em `ResolveAffiliateProductUseCase.test.ts` e `GenerateOfferUseCase.test.ts` (`:202`)
**Depende**: — · **Requisito**: TLINK-25, 26, 27
**Pronto quando**:
- [ ] `/social/sevenclub?matt_word=sevenclub2025` + credencial `sevenclub2025` → `verified`
- [ ] mesmo link + credencial de outro → `not_owned`
- [ ] `meli.la` (colada) + final com apelido ≠ etiqueta do tenant → `verified`
- [ ] dois `matt_word` distintos → `not_owned` (inalterado)
- [ ] `/social/<x>` sem `matt_word` → comportamento atual (inalterado)
- [ ] Casos existentes de `verifyAffiliateLink.test.ts:10-37` passam sem edição (ex.: `/social/etq?matt_word=outra` + cred `etq` segue `not_owned`, agora porque o `matt_word` é de outro)
- [ ] Amazon, Shein, Shopee: nenhum teste muda
**Testes**: unit · **Gate**: full
**Commit**: `fix(campaigns): aceita link próprio do ML quando o apelido do perfil difere da etiqueta`

### TH2: Versão, CHANGELOG e doc

**Onde**: `api/package.json` → 0.79.1 (base real 0.79.0; conferir a próxima livre); `api/CHANGELOG.md` (seção nova no topo, formato `## [X.Y.Z · app A.B.C] — data — título`); `CHANGELOG.md` raiz (`[Unreleased]`, `### Fixed — api 0.79.1 — …`); `docs/gerador-de-ofertas.md:40` (prova do ML =
`matt_word`; `/social/` é apelido, só vale sem `matt_word`)
**Depende**: TH1 · **Pronto quando**: causa raiz descrita no CHANGELOG (apelido × etiqueta, 84/86 em produção).
**Commit**: `chore(release): api 0.79.1`

Depois do deploy: pedir ao usuário do vídeo para repetir o teste.

## FE — Etiquetas do Mercado Livre por plano (depende só da FH; não depende de D1–D3)

Branch `feature/ml-account-tags` a partir de `feature/rebranding-app`, depois do merge da FH. Versão: api 0.80.0 ·
app 0.99.0 (conferir a próxima livre). Requisitos TLINK-28..39.

| # | Task | Depende | Onde | Pronto quando / Gate |
| --- | --- | --- | --- | --- |
| TE0 | **Portão**: teste real em conta ML com 2+ etiquetas (a do dono, com 2ª etiqueta criada para o teste; conta de cliente só com autorização). Registrar em `docs/extensao-ml-endpoints.md`: resposta de `/stripe/user/tags` com várias etiquetas; `createLink` com etiqueta da conta que não é a `in_use` | FH | script em `scripts/diagnostics/` (só leitura no ML, sem banco) | Formato anotado; resposta "aceita / recusa" do `createLink` decide a regra de recriação do design. Se o formato não trouxer a lista, **parar e replanejar** |
| TE1 | Chave `MERCADO_LIVRE_AFFILIATE_TAGS` + presets 1/2/10 + `identifierLimitOf` (`?? 1`); chave em `SUBSCRIPTION_HIDDEN_KEYS` da API por enquanto; **no app, na mesma task**: chave, `CATALOG_FIELD` e label em `subscription/strings.ts` e campo `limits.mercadoLivreTags` no catálogo | TE0 | `tenants/domain/entitlementKeys.ts`, `planPresets.ts` (+ teste), `tenants/domain/services/subscriptionLimits.ts` (+ teste `:17-20`), `tenants/domain/services/affiliateIdentifierLimit.ts` (`identifierLimitOf`, + teste); `app/src/features/subscription/strings.ts` (`:17-39,49-60,176-196`), `app/src/features/plans/catalog.ts` + `catalog.test.ts` (literais `:50-54`, `:67-71`) | testes dos presets e da assinatura (API) verdes; `subscription/__tests__/strings.test.ts:24,28-31` (app) verde; ausente/null → 1 · **full** (api e app) |
| TE2 | Migration: colunas `accountIdentifiers`/`linkedIdentifiers` + presets + backfill por `planSlug` **filtrado pela chave nova** | TE1 | `api/prisma/schema.prisma:721-750`, `api/prisma/migrations/<ts>_add_affiliate_account_identifiers_and_ml_tags_entitlement/` | `prisma validate`; SQL conferido em Postgres descartável (nunca `api/.env`): tenant existente sai com a chave no valor do plano e **nenhuma outra chave muda**; sem `ALTER TYPE` de auditoria · full |
| TE3 `[P]` | `listAccountTags` no cliente ML (`tags: string[] \| null`); `getActiveTag` delega | TE0 | `IMercadoLivreAffiliateClient.ts`, `MercadoLivreAffiliateClient.ts` (+ teste) | casos: 1 etiqueta, várias, nenhuma `in_use`, array × `{tags}`, falha de rede e JSON ilegível → `tags: null` sem lançar, 401/403/429 lançam · quick (api) |
| TE4 `[P]` | Regra pura `effectiveLinkedIdentifiers` | TE1 | `integrations/domain/services/` (+ teste) | limite 1/2/10/null, rebaixamento, repetidos · quick (api) |
| TE5 | Entidade, DTO, repositório, mapper e sincronização guardam a lista da conta; desconexão limpa | TE2, TE3 | `integrations/domain/entities/AffiliateCredential.ts` (campos opcionais), `application/dtos/AffiliateCredentialDTO.ts`, `IAffiliateCredentialRepository.ts`, `AffiliateCredentialRecords.ts`, `PrismaAffiliateCredentialRepository.ts:96-157` (+ `.int.test.ts`), mapper, `UpsertAffiliateSessionUseCase.ts` (+ teste), `extension.routes.ts:242` (+ teste) | lista gravada na sync; `tags: null` não toca nas colunas; inválidas descartadas; vinculada que saiu da conta é removida; `clearSession` zera as duas colunas; mudança de token não zera nada (sem detecção de troca de conta nesta fase; a poda cobre); a rota chama `listAccountTags` e passa `accountIdentifiers` ao use case; principal segue "só se vazia"; fixtures existentes compilam sem edição · full |
| TE6 | Use cases e rotas de vincular etiquetas; listagem e Assinatura com os dados novos | TE4, TE5 | `integrations/application/use-cases/{Get,SetLinked}AffiliateIdentifiersUseCase.ts` (+ testes), `affiliateCredential.routes.ts` (+ teste), `affiliateCredential.schema.ts:6-22`, `AffiliateCredentialPresenter.ts:10-23` (+ teste), `AffiliateCredentialErrors.ts`, `tenants/domain/services/subscriptionLimits.ts` (`HIDDEN` → `ITEMS`, `SubscriptionUsage`, ramo próprio em `usedOf`; + teste e fixture `:5-12`), `PrismaTenantUsageReader.ts:7,33`, `tenants/application/use-cases/GetTenantSubscriptionUseCase.test.ts:9-15` (fixture `USAGE` tipada) | acima do limite → `PLAN_LIMIT_REACHED`; fora da conta → recusa; filtra por `tenantId`; proteção igual às demais rotas de credencial; auditoria `AFFILIATE_CREDENTIAL_UPSERTED` sem as etiquetas; item da listagem traz os campos; Assinatura mostra uso × limite · full |
| TE7 | Credencial resolvida repassa as listas; verificação aceita conjunto; Resolve distingue "da conta, não vinculada" | TE6, TH1 | `IAffiliateCredentialResolver.ts` (campos opcionais), `ResolveAffiliateCredentialUseCase.ts` (+ teste; construtor **não** muda), `verifyAffiliateLink.ts` (+ teste), `ResolveAffiliateProductUseCase.ts` (+ teste; passo entre `:83` e `:84`, limite por `entitlements.getNumber`) | vinculada → `verified` mantendo a etiqueta; da conta com vaga → `AFFILIATE_IDENTIFIER_NOT_LINKED`; da conta sem vaga → `PLAN_LIMIT_REACHED`; de terceiro → comportamento atual; rebaixado respeita o limite; teste de regressão: builder do monitoramento e link gerado usam a principal mesmo com vinculadas (TLINK-35); `offersContainer.ts` e testes do builder/gerador sem edição · full |
| TE8 `[P]` | Painel: card, banner e aviso de recurso | TE1 | `plans/components/PlanCard.tsx` (+ teste; linha do limite abaixo da tabela), `PlansHero.tsx` (+ teste: selo do ML nos dois temas; selo vira mapa por provider), `PlansFeatureNotice` (+ teste), `plans/strings.ts` | número 1/2/10 visível no card; selo no ML no banner (claro/escuro); chave `?feature=` criada; skill `copywriting`; sem ícone de brilho · quick (app) |
| TE9 | Painel: aviso de upgrade (PRO e MAX) e erros nas três telas | TE7, TE8 | `linkRotation/planUpsell.ts` (`plansAbove`, `LIMIT_OF`), `linkRotation/strings.ts`, `linkRotation/components/PlanLimitBanner.tsx` (+ `__tests__/PlanLimitBanner.test.tsx`), `offers/utils/offerErrors.ts` (+ teste; ramo próprio da chave, `CREDENTIAL_CODES`), `offers/strings.ts`, `pages/offers/OfferGeneratorPage.tsx` (estado + render do banner), `storefront/{storefrontForm.ts,strings.ts,hooks/useStorefrontPage.ts,components/AddOfferCard.tsx}` (+ testes), `offerStory/{productForm.ts,strings.ts,components/ProductStep.tsx}` (+ testes), `types/api.types.ts` | LITE com etiqueta não vinculada abre o aviso listando PRO **e** MAX (kinds antigos seguem com um plano só); com vaga mostra botão para credenciais; vitrine e story com texto + link para planos (ação `'plans'`); nenhum dos dois códigos cai em texto genérico · quick (app) |
| TE10 | Painel: vincular etiquetas na tela de credenciais | TE6 | `pages/settings/AffiliateCredentialsPage.tsx` (passa `item` ao diálogo do ML), `settings/components/BrowserSessionCredentialDialog.tsx` (+ teste), `AffiliateCredentialCard.tsx` (+ teste), `hooks/useAffiliateCredentials.ts` (+ teste do método novo), `services/affiliateCredential.service.ts`, `types/api.types.ts` (`AffiliateCredentialItem`), `settings/strings.ts`, `privacy/privacyFlags.ts` | etiquetas vêm só da API (a da extensão deixa de ser exibida); lista, principal, contador "x de y", item indisponível pelo padrão, botão para `AFFILIATE_PLANS_PATH` quando o limite impede, flag de privacidade + `Blurred` no card e no diálogo, pedido de escolha quando a principal está vazia e a conta tem etiquetas; rascunho em `usePersistedState`; skill `ui-ux-pro-max`; conferido com `agent-browser` claro/escuro · quick (app) |
| TE11 | Docs, versão e CHANGELOG | TE7..TE10 | `docs/integracoes-credenciais-afiliado.md` (`:28`, `:109-120`), `docs/planos.md` (`:21-52`), `docs/produto-roadmap.md` (`:74-114`), `docs/gerador-de-ofertas.md`, `docs/extensao-ml-endpoints.md`, `AGENTS.md` (linha de credenciais), `api/package.json`, `app/package.json`, CHANGELOGs | regra, limites, o que não fazer (não atualizar lista na geração; não trocar a principal sozinho); migration citada em **Breaking/Migration**; smoke com a conta do TE0 · full |

Depois do deploy: pedir ao usuário do vídeo que sincronize a extensão e repita o teste.

```
FE  FH ──→ TE0 ──→ TE1 ──→ TE2 ──┐
           TE0 ──→ TE3 [P] ──────┴──→ TE5 ──→ TE6 ──→ TE7 ──┐
           TE1 ──→ TE4 [P] ─────────────────→ TE6 ──→ TE10  │
           TE1 ──→ TE8 [P] ─────────────────────────────────┴──→ TE9
           TE7..TE10 ──→ TE11
```

## F0 — Portão

| # | Task | Depende | Verificação |
| --- | --- | --- | --- |
| T0 | Dono aprova D1, D2, D3 da spec. Registrar em `.specs/features/tenant-affiliate-link/context.md` e em `.specs/project/STATE.md` (substitui `:114-116`) | — | Decisões escritas; spec com status "Aprovada" |

## F1 — Núcleo (API, sequencial)

### T1: Erros novos

**O quê**: `OfferLinkRebuildFailedError`, `OfferTextForeignLinkError`, `AffiliateCredentialRequiredError` (`AFFILIATE_CREDENTIAL_REQUIRED`, 422, `{provider}`); `StorefrontOfferLinkUnverifiedError` em `StorefrontErrors.ts`. **Não tocar** em `AffiliateCredentialNotFoundError` (`AffiliateCredentialErrors.ts:5-9`, 404, usado no CRUD).
**Onde**: `api/src/shared/errors/internal/OfferErrors.ts`, `api/src/shared/errors/internal/StorefrontErrors.ts`
**Depende**: T0 · **Requisito**: TLINK-06, 08, 15, 21
**Pronto quando**: classes com código, status e `meta` do design; nenhuma URL em `meta`; `tsc` limpo.
**Testes**: none · **Gate**: quick (api)
**Commit**: `feat(campaigns): erros de recriação de link e de texto com link alheio`

### T2: Extrair `TenantAffiliateLinkComposer` do builder

**O quê**: mover o switch por marketplace e `mlRefFromPage` para o composer; builder passa a delegar. Extração pura: nenhuma checagem nova (a allowlist de Shopee/ML entra só no Resolve, T4).
**Onde**: `campaigns/application/services/TenantAffiliateLinkComposer.ts` (novo) + teste; `BuildTenantAffiliateLinkUseCase.ts`; `offersContainer.ts`
**Depende**: T1 · **Reusa**: `BuildTenantAffiliateLinkUseCase.ts:113-203`, `setup()` do teste do builder
**Requisito**: TLINK-05, 23
**Pronto quando**:
- [ ] `BuildTenantAffiliateLinkUseCase.test.ts` passa **sem alterar expectativas** (só o `setup`, se preciso)
- [ ] Composer não importa `markRejected`, expander nem entitlements; `ok` traz `productRef`
- [ ] Testes do composer: 4 marketplaces `ok`; `unsupported`; `credential_missing` (Shopee sem secret, ML sem cookies, Shein sem `AT`); `risk_not_accepted`; Shein com share fora da allowlist → `failed` (já existente); `AppError` da loja sobe
- [ ] Testes do monitoramento (`automation`) verdes
**Testes**: unit · **Gate**: full
**Commit**: `refactor(campaigns): extrai composição do link do tenant do builder`

### T3: Regra "manter o colado"

**O quê**: (1) mover `isShortLink` + `SHORT_HOSTS` de `infrastructure/http/HttpShortLinkExpander.ts:21` para `domain/services/isShortLink.ts`; o expander importa de lá e **reexporta** `isShortLink` (`HttpShortLinkExpander.test.ts:2` importa de `./HttpShortLinkExpander` e segue verde sem edição). (2) função pura `shouldKeepPastedLink(provider, source, final, credentialIdentifier)` = verificado + link curto oficial + não Amazon.
**Onde**: `campaigns/domain/services/{isShortLink.ts,shouldKeepPastedLink.ts}` + testes; `HttpShortLinkExpander.ts`
**Depende**: T0 (D2), TH1 · **Reusa**: `verifyAffiliateLink` (já com a precedência da TH1)
**Requisito**: TLINK-04
**Pronto quando**: tabela de casos por marketplace no teste (curto do tenant → true; longo do tenant → false, usando `www.mercadolivre.com.br/social/…` — `mercadolivre.com/social/…` conta como curto; curto de outro → false; Shopee → false; Amazon → false; identificadores divergentes → false); nenhum arquivo de `domain/` importa `infrastructure/`.
**Testes**: unit · **Gate**: quick (api) · pode correr junto com T2 `[P]`
**Commit**: `feat(campaigns): regra para manter link curto já do tenant`

### T4: Resolve recria em vez de recusar

**O quê**: reescrever `execute` conforme o fluxo do design (passos 1–7); remover `generateMlAffiliateLink`, o ramo de troca de link de `resolveShein`, `readCredential` especial; parar de lançar `OfferLinkNotOwnedError`/`OfferLinkNotAffiliateError` (as classes ficam até a T10b); `resolveState` nos 4; `linkRebuilt` no retorno.
**Onde**: `ResolveAffiliateProductUseCase.ts` + teste; `offersContainer.ts`
**Depende**: T2, T3 · **Requisito**: TLINK-01..04, 06..12
**Pronto quando**:
- [ ] Matriz no teste: {Shopee, ML, Amazon, Shein} × {link de outro curto, de outro longo, limpo, do tenant curto, do tenant longo, divergente} × {credencial ok, ausente, recusada} — nenhuma célula devolve URL com identificador alheio nem o link colado de terceiro
- [ ] Recusa na hora **não** chama `markRejected` (dep nem existe no tipo)
- [ ] Falha do ML vira `RATE_LIMITED`/`UNAVAILABLE`/`REBUILD_FAILED`, nunca `NOT_AFFILIATE`
- [ ] Passo de etiqueta da FE preservado: etiqueta da conta não vinculada continua dando `AFFILIATE_IDENTIFIER_NOT_LINKED`/`PLAN_LIMIT_REACHED` (não é recriada com a principal); etiqueta vinculada conta como `verified`
- [ ] Gate `ref || mlSocial` continua **antes** da credencial: link de cupom/lista sem produto e sem loja conectada → `OFFER_URL_UNSUPPORTED`, não `AFFILIATE_CREDENTIAL_REQUIRED`
- [ ] Todo link recriado (os 4 marketplaces; novidade para Shopee e ML) passa por `isSupportedShareLink` no Resolve; fora da allowlist → `OFFER_LINK_REBUILD_FAILED`
- [ ] Link curto do tenant mantido: dados do produto pelo caminho de hoje (Shein com `AT` chama `getProductShare` só para dados; sem `AT` produto vazio)
- [ ] Vitrine social ML recriada: página lida uma vez quando o card traz dado; `productRef` vem do `ok` do composer
- [ ] `sourceUrl` devolvido é sempre o colado, nunca o canônico do composer
- [ ] Casos antigos reescritos para o comportamento novo: os de `NOT_OWNED`/`NOT_AFFILIATE` **e** "sessão, link do próprio tenant" da Shein (`:175`, `:218-229`: link longo com `url_from` do tenant passa a ser recriado, D2). Contagem de testes não cai abaixo de 23
**Testes**: unit · **Gate**: full
**Commit**: `feat(campaigns): recria o link de afiliado com a credencial do tenant`

## F2 — Consumidores (API)

### T5: Gerador usa a instância do container `[P]`

**Onde**: `GenerateOfferUseCase.ts` + teste (inclui o `setup` `:35-63`, que hoje monta o use case sem Resolve); `presentation/schemas/offer.schema.ts` (`generateOfferResponse`, envelope; `OfferDTO`/`toOfferDto` não mudam); `offer.routes.test.ts`; `offersContainer.ts` (literal de `generate`, `:106-119`)
**Depende**: T4 · **Requisito**: TLINK-11, 12
**Pronto quando**: sem `new ResolveAffiliateProductUseCase` no gerador; `GenerateOfferDeps` sem `expander`/`credentials`/`mercadoLivre`/`shein`/`riskGate`; resposta HTTP com `linkRebuilt` no topo do envelope (return de `GenerateOfferUseCase` `:140-144` + `generateOfferResponse`); testes `:150-202` reescritos (link de outro → oferta com link do tenant); rota devolve 422 dos códigos novos.
**Testes**: unit · **Gate**: quick (api)
**Commit**: `feat(campaigns): gerador devolve link recriado e sinaliza a troca`

### T6: Vitrine sem troca própria `[P]`

**Onde**: `ExtractStorefrontOfferUseCase.ts` + teste; `storefrontUseCaseDeps.ts` (`:47`); `storefrontContainer.ts`; `storefrontTestFakes.ts`; rota/schema da extração (`storefront.routes.ts`, `storefront.schema.ts`)
**Depende**: T4 · **Requisito**: TLINK-13
**Pronto quando**: sem dep `buildAffiliateLink`; nenhum ramo grava link colado com `verified=false`; item novo sempre `attributionVerified=true`; use case devolve `{offer, linkRebuilt}`; a resposta de criação traz `linkRebuilt` dentro de `data` (campo opcional no schema do item; listagem não envia).
**Testes**: unit · **Gate**: quick (api)
**Commit**: `fix(storefront): item da vitrine só entra com link do tenant`

### T7: Publicação bloqueia item não verificado `[P]`

**Onde**: `SetStorefrontOfferStatusUseCase.ts` + teste
**Depende**: T1 · **Requisito**: TLINK-15
**Pronto quando**: publicar com `attributionVerified=false` → `STOREFRONT_OFFER_LINK_UNVERIFIED`; despublicar segue livre.
**Testes**: unit · **Gate**: quick (api)
**Commit**: `fix(storefront): não publica item com link não verificado`

### T8: Story `[P]`

**Onde**: `RenderOfferStoryUseCase.ts` (repassa `resolved.linkRebuilt`), `OfferStoryUseCases.test.ts`, `offerStoryTestFakes.ts`, `offerStory.schema.ts` (`renderOfferStoryResponse`)
**Depende**: T4 · **Requisito**: TLINK-14
**Pronto quando**: resposta com `linkRebuilt`; teste `:96-97` reescrito; erros chegam com o status original (422; `RATE_LIMITED` 429; `UNAVAILABLE` 503).
**Testes**: unit · **Gate**: quick (api)
**Commit**: `feat(offer-story): story usa link recriado do tenant`

### T9: Texto editado e prévia `[P]`

**Onde**: `campaigns/domain/services/{extractUrls.ts,findForeignMarketplaceLinks.ts}` + testes; `automation/domain/services/offerMessageText.ts` (importa `extractUrls`, `URL_PATTERN`, `TRAILING`, `toHref`, `FoundUrl` de campaigns e reexporta `extractUrls`; `offerMessageText.test.ts` sem edição); `UpdateOfferUseCase.ts` + teste; `pickPreviewUrl.ts` + teste
**Depende**: T1, T0 (D3) · **Requisito**: TLINK-21, 22
**Pronto quando**: link de host de marketplace **acrescentado** na edição (fora do texto gravado e ≠ `affiliateUrl`) → erro, inclusive com `http://` e sem protocolo; comparação por `href`; oferta do monitoramento com 2+ links do tenant salva sem erro quando os links não mudam; convite de grupo e outros hosts passam; prévia só com `affiliateUrl`; sem import campaigns → automation; testes do monitoramento verdes.
**Testes**: unit · **Gate**: quick (api)
**Commit**: `fix(campaigns): texto da oferta não aceita link de produto alheio`

### T10: Limite de taxa no gerador `[P]`

**Onde**: `api/src/shared/http/rateLimitPresets.ts`, `offer.routes.ts` + teste
**Depende**: T5 · **Requisito**: TLINK-24
**Pronto quando**: preset por tenant no mesmo padrão de vitrine/story; teste de rota registra `@fastify/rate-limit` (como `storefront.routes.test.ts:59`; hoje `offer.routes.test.ts:56-58` não registra e o 429 nunca apareceria) e cobre 429.
**Testes**: unit · **Gate**: quick (api)
**Commit**: `feat(campaigns): limite de taxa na geração de oferta`

### T10b: Remover classes de erro mortas

**O quê**: apagar `OfferLinkNotOwnedError` e `OfferLinkNotAffiliateError` (`OfferErrors.ts:106-115`) e qualquer import restante.
**Depende**: T5, T6, T8 (testes que as importam já reescritos) · **Requisito**: TLINK-11
**Pronto quando**: `grep -rn "OfferLinkNotOwned\|OfferLinkNotAffiliate" api/src` vazio.
**Testes**: none · **Gate**: full
**Commit**: `refactor(campaigns): remove erros de dono do link que não são mais lançados`

## F3 — Painel

### T11: Módulo comum de erros e textos

**Onde**: `app/src/features/affiliateLinks/{linkErrors.ts,strings.ts}` + testes; `types/api.types.ts` (`linkRebuilt`). Reusa `app/src/features/settings/affiliateProviders.ts` (nomes das lojas) e `AFFILIATE_CREDENTIALS_PATH` (`app/src/features/navigation/model.ts:77`)
**Depende**: T5 (contrato) · **Requisito**: TLINK-18, 19
**Skill**: `copywriting` para os textos
**Pronto quando**: `describeAffiliateLinkError` cobre os códigos do design e devolve `null` para os demais; não substitui os adaptadores das features (formatos diferentes, ver design); texto por loja via `affiliateProviders.ts`; frase com variável é função tipada; sem nome da marca.
**Testes**: unit · **Gate**: quick (app)
**Commit**: `feat(app): mapa único de erros de link de afiliado`

### T12: Componentes `ConnectStoreAction` e `LinkRebuiltNotice`

**Onde**: `app/src/features/affiliateLinks/components/` + testes
**Depende**: T11 · **Requisito**: TLINK-17, 18, 20
**Skill**: `ui-ux-pro-max`
**Pronto quando**: `AppIcon` (sem ícone MUI, sem brilho), `Tooltip arrow describeChild`, `returnTo` com a rota atual; teste com `renderWithTheme` no tema escuro.
**Testes**: unit · **Gate**: quick (app)
**Commit**: `feat(app): aviso de link recriado e atalho para conectar loja`

### T13: Gerador `[P]`

**Onde**: `features/offers/{strings.ts,utils/offerErrors.ts,utils/offerErrors.test.ts,utils/offerStore.test.ts,components/OfferGeneratorForm.tsx,components/OfferResultPanel.tsx,hooks/useOfferGenerator.ts}`, `pages/offers/OfferGeneratorPage.tsx`
**Depende**: T12, T9 (comportamento do erro de texto) · **Requisito**: TLINK-16, 17, 20, 21
**Pronto quando**: rótulo/ajuda novos; `shopeeNotice` e textos `NOT_OWNED`/`NOT_AFFILIATE` removidos; teste `offerStore.test.ts:51-56` reescrito; `offerErrors.ts` delega ao módulo comum; `CREDENTIAL_CODES` (`:26`) ganha `AFFILIATE_CREDENTIAL_REQUIRED`; `LINK_CODES` (`:28`) perde os dois removidos e ganha `OFFER_LINK_REBUILD_FAILED`, `AFFILIATE_API_RATE_LIMITED`, `AFFILIATE_API_UNAVAILABLE`; mantém `planLimit`, `config`/`sessions` e Shein fora do plano (`offerErrors.test.ts:31-39` verde); `OFFER_TEXT_FOREIGN_LINK` mapeado com texto próprio como erro de página ao salvar a edição (hoje cairia em `errors.generic`); `useOfferGenerator.ts` guarda `linkRebuilt` junto de `needsManualData`/`aiFallback` (`:24,80,97`); aviso de recriado no resultado, sem URL.
**Testes**: unit · **Gate**: quick (app)
**Commit**: `feat(app): gerador aceita qualquer link e avisa quando recria`

### T14: Página de Ofertas `[P]`

**Onde**: `features/storefront/{storefrontForm.ts,storefrontForm.test.ts,strings.ts,types.ts,components/AddOfferCard.tsx,hooks/useStorefrontPage.ts}` + testes; `app/src/services/storefront.service.ts` (tipo de retorno da criação) + `storefront.service.test.ts`; `StorefrontPage.test.tsx`
**Depende**: T12, T6 · **Requisito**: TLINK-16..18
**Pronto quando**: códigos novos entram em `STOREFRONT_ERROR_CODES` (`storefrontForm.ts:183-206`) e os de credencial em `ADD_FIELD_CODES` (`useStorefrontPage.ts:50`); `AddOfferCard` ganha `errorAction` e mostra o botão abaixo do campo (hoje `error?: string`, `:28`); publicar (`toggleStatus` `:236` → `fail` `:116`) mostra texto próprio para `STOREFRONT_OFFER_LINK_UNVERIFIED`; `storefrontForm.test.ts:205-224` reescrito (códigos removidos); aviso de recriado ao adicionar (`linkRebuilt` opcional no item devolvido pela criação, `types.ts`); cópias de texto removidas.
**Testes**: unit · **Gate**: quick (app)
**Commit**: `feat(app): vitrine encaminha para conectar loja e avisa link recriado`

### T15: Story `[P]`

**Onde**: `features/offerStory/{productForm.ts,productForm.test.ts,strings.ts,types.ts,hooks/useOfferStoryWizard.ts,hooks/useOfferStoryWizard.test.ts,components/ProductStep.tsx,components/ResultStep.tsx}`
**Depende**: T12, T8 · **Requisito**: TLINK-16..18
**Pronto quando**: `types.ts:31` com `linkRebuilt`; `OFFER_STORY_ERROR_CODES` (`productForm.ts:78-97`) e `URL_CODES` (`:100`) sem os códigos removidos e com os novos; `useOfferStoryWizard.test.ts:103-105` e `productForm.test.ts:46-49` reescritos; `backToTemplates` preservado; botão de conectar loja no passo do produto; aviso de recriado no resultado.
**Testes**: unit · **Gate**: quick (app)
**Commit**: `feat(app): story encaminha para conectar loja e avisa link recriado`

## F4 — Fechamento

### T16: Documentação

**Onde**: `docs/gerador-de-ofertas.md` (`:3`, `:33-49`, `:64-75`), `docs/pagina-de-ofertas.md:92-96`, `docs/story-de-oferta.md:24-28`, `docs/afiliado-shein.md:55-61`, `docs/integracoes-credenciais-afiliado.md:123-127`, `docs/monitoramento-grupos.md` (nota: mesmo composer), `docs/produto-roadmap.md` (`:23`, `:28`, `:31`, `:32`), `docs/mensagens-previa-de-link.md:34` (`pickPreviewUrl`), `docs/story-de-oferta.md:96` (resposta com `linkRebuilt`), `AGENTS.md` (linha do gerador: "link sempre recriado/provado; nunca devolver o colado"), marcar como substituídos nas specs antigas: GEN-02, STORE-09 (`storefront/spec.md:137`), SHEIN-10 e a decisão #4 de `offer-story/context.md:35`.
**Depende**: T5..T15 (inclui T10b) · **Pronto quando**: nenhuma doc afirma a regra antiga (`grep -rn "NOT_OWNED\|próprio link" docs/`); seção "o que não fazer" do design copiada para a doc do gerador.
**Commit**: `docs(campaigns): link de afiliado sempre do tenant`

### T17: Versão e CHANGELOG

**Onde**: `api/package.json` → 0.81.0; `app/package.json` → 0.100.0 (FH usa 0.79.1 e FE usa 0.80.0/0.99.0; conferir a próxima livre); `api/CHANGELOG.md` (seção nova no topo; o arquivo não tem `[Unreleased]`); `CHANGELOG.md` raiz (`[Unreleased]`, bloco próprio `### Added — api 0.81.0 · app 0.100.0 — …`)
**Depende**: T16 · **Pronto quando**: entradas Added/Changed/Removed/Fixed com arquivos; **Breaking** declarado: `OFFER_LINK_NOT_OWNED`/`NOT_AFFILIATE` removidos, `unverified` deixa de passar, loja sem credencial bloqueia.
**Commit**: `chore(release): api 0.81.0 · app 0.100.0`

### T18: Verificação final

**Depende**: T17
- [ ] `full` gate em `api/` e `app/`
- [ ] `/caveman-review` do diff (só contradição com código; parar na convergência)
- [ ] Smoke local com Postgres descartável (nunca `api/.env`): link da foto (`meli.la` de outro) → oferta com link do tenant; Shopee de outro com e sem credencial; Amazon limpa; vitrine e story
- [ ] `agent-browser`: gerador, vitrine e story em claro e escuro — aviso, erro com botão, retorno pelo `returnTo`
- [ ] Teste real das lojas a partir da Render fica como pendência registrada (ML e Shein não testáveis localmente)

## Mapa de execução

```
FH  TH1 ──→ TH2                    (independente; sai primeiro)
F0  T0
F1  T1 ──→ T2 ──┐
    T0, TH1 ──→ T3 ──┴──→ T4            (T3 [P] com T2)
F2  T4 ──→ T5 [P] ──→ T10
    T4 ──→ T6 [P]
    T1 ──→ T7 [P]
    T4 ──→ T8 [P]
    T1 ──→ T9 [P]                  (máx. 3 subagentes por vez: T5,T6,T8 → T7,T9,T10)
    T5,T6,T8 ──→ T10b
F3  T5 ──→ T11 ──→ T12 ──→ T13 [P] (também T9), T14 [P] (também T6), T15 [P] (também T8)
F4  T5..T15 ──→ T16 ──→ T17 ──→ T18
```

## Conferência diagrama × tasks

| Task | Depende (corpo) | Diagrama | OK |
| --- | --- | --- | --- |
| TH1 | — | início de FH | ✅ |
| TH2 | TH1 | TH1→TH2 | ✅ |
| T1 | T0 | F0→F1 | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T0, TH1 | T0,TH1→T3 | ✅ |
| T4 | T2, T3 | T2,T3→T4 | ✅ |
| T5, T6, T8 | T4 | T4→ | ✅ |
| T7, T9 | T1 (+T0) | T1→ | ✅ |
| T10 | T5 | T5→T10 | ✅ |
| T10b | T5, T6, T8 | T5,T6,T8→T10b | ✅ |
| T11 | T5 | T5→T11 | ✅ |
| T12 | T11 | T11→T12 | ✅ |
| T13 | T12, T9 | T12→, T9→ | ✅ |
| T14 | T12, T6 | T12→, T6→ | ✅ |
| T15 | T12, T8 | T12→, T8→ | ✅ |
| T16 | T5..T15 | →T16 | ✅ |
| T17 | T16 | T16→T17 | ✅ |
| T18 | T17 | T17→T18 | ✅ |

## Granularidade

T4 é a maior (um arquivo + teste, uma função). T13–T15 tocam 4–6 arquivos cada, todos da mesma feature e do mesmo
ajuste (trocar mapa de erro + aviso): coesas, mantidas inteiras. T16 é só texto.
