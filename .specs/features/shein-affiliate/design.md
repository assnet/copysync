# Afiliado Shein — Desenho

Depende de `spec.md`. Tudo que cita a Shein por dentro (endpoint, header, corpo) vale **como observado em
2026-11-10** e é reconfirmado na T0; mudou lá, muda aqui antes de codar.

## Visão

```
extensão ──cookies AT+memberId──▶ PUT /extension/marketplaces/shein/session
                                      │ gate plano + consentimento
                                      ▼
                         affiliate_credentials (SHEIN): sessão cifrada, publicIdentifier = memberId
                                      │
gerador / vitrine / story ─▶ ResolveAffiliateProductUseCase ─┐
monitoramento ─▶ BuildTenantAffiliateLinkUseCase ────────────┼─▶ ISheinAffiliateClient.getProductShare
                                                             │      POST m.shein.com …/detailNew (header token)
                              HttpShortLinkExpander (onelink: 200 HTML → URL do produto)
```

Uma tabela nova (aceites de risco, só de inclusão). Sem rota pública nova. Shein nunca é lida por página.

## Banco

1. Migration `add_shein_affiliate_provider`: `ALTER TYPE "AffiliateProvider" ADD VALUE 'SHEIN';` — sozinha
   no arquivo (valor novo de enum não pode ser usado na mesma transação).
2. Migration `add_shein_extension_consent`: `ALTER TABLE "extension_sessions" ADD COLUMN "sheinConsentAt" TIMESTAMP(3);`
3. Migration `add_audit_action_plan_entitlement_changed`: `ALTER TYPE "AuditAction" ADD VALUE 'PLAN_ENTITLEMENT_CHANGED';`
   (enum fechado, `schema.prisma:52`; precedente `20261029000000_add_audit_action_affiliate_credential_rejected`)
   + valor na união de `shared/audit/IAuditLogRepository.ts:5-31`.
4. Migration `create_marketplace_risk_acceptances` — tabela nova, só de inclusão:

   | Coluna | Tipo | Nota |
   |---|---|---|
   | `id` | `String @id @default(cuid())` | |
   | `tenantId` | `String` | FK `Tenant`, `onDelete: Cascade` |
   | `provider` | `AffiliateProvider` | hoje só `SHEIN` usa |
   | `noticeVersion` | `String` | ex. `2026-11-10`; constante no domínio |
   | `acceptedByUserId` | `String` | FK `User`, `onDelete: Restrict` (aceite não some com o usuário) |
   | `locale` | `String` | idioma em que o painel exibiu o texto (ex. `pt-BR`) |
   | `acceptedAt` | `DateTime @default(now())` | hora do servidor, UTC |

   `@@unique([tenantId, provider, noticeVersion])` (um aceite por versão por tenant; reaceite da mesma
   versão é no-op e devolve o existente) e `@@index([tenantId, provider])`. Sem `update` nem `delete` no
   repositório. Timestamp posterior ao da migration 1 (enum).
5. Migration `add_audit_action_marketplace_risk_accepted`: `ALTER TYPE "AuditAction" ADD VALUE 'MARKETPLACE_RISK_ACCEPTED';`
   + valor na união de `IAuditLogRepository.ts`.
6. Migration de dados `add_marketplace_shein_entitlement`, no molde de
   `20261110120000_restrict_ai_rewrite_to_pro_max`: presets `marketplace_shein_enabled` false/false/true +
   `tenant_entitlements` dos tenants de cada plano (o sync só roda em evento de billing).

`CapturedOffer.reason` é `String?` (`schema.prisma:1324`): motivo novo não pede migration.

## API

### Domínio

| Arquivo | Mudança |
|---|---|
| `integrations/domain/enums/AffiliateProvider.ts` | `'SHEIN'` na lista |
| `integrations/domain/services/affiliateProviderFields.ts` | `SHEIN: { publicIdentifier: { pattern: /^\d{6,15}$/, maxLength: 15 }, secret: null, usesSession: true }` + `providerIdentifierFollowsSession(provider)` (true só para SHEIN) |
| `campaigns/domain/services/detectMarketplace.ts` | `SHEIN: ['br.shein.com', 'm.shein.com', 'onelink.shein.com']` (hosts exatos + subdomínio pela regra atual; **não** `shein.com` inteiro) |
| `campaigns/domain/services/parseProductRef.ts` | `{ provider: 'SHEIN'; goodsId: string }`; regex `/-p-(\d{4,12})(?:-cat-\d+)?\.html$/i` no `pathname`; `m.shein.com` só com prefixo `/br/` |
| `campaigns/domain/services/verifyAffiliateLink.ts` | identificador = `url_from` casando `^affiliate_koc_(\d+)$` (grupo 1); `url_from` de outro formato = sem identificador |
| `campaigns/domain/contracts/ISheinAffiliateClient.ts` | novo, abaixo |
| `campaigns/domain/services/marketplaceEntitlement.ts` | novo: `marketplaceEntitlementKey(provider): EntitlementKey \| null` (só SHEIN tem chave) |
| `tenants/domain/entitlementKeys.ts` | `MARKETPLACE_SHEIN_ENABLED: 'marketplace_shein_enabled'` (ausente = bloqueado) |
| `tenants/domain/planPresets.ts` | false / false / true |
| `integrations/domain/services/marketplaceRiskNotice.ts` | novo: `MARKETPLACE_RISK_NOTICE_VERSION: Partial<Record<AffiliateProvider, string>>` (`SHEIN: '2026-11-10'`) e `requiresRiskAcceptance(provider)`. O **texto** do aviso vive só no painel, que espelha a versão em `features/settings/strings.ts`. Não existe teste cruzando `api/` e `app/`: um teste **do app** trava o hash do texto pt-BR junto da versão espelhada (mudou texto sem mudar versão → falha); versão do app ≠ da API aparece em runtime como 409 |
| `integrations/domain/contracts/IMarketplaceRiskAcceptanceRepository.ts` | novo: `findCurrent(tenantId, provider, version)`, `create(...)`, `listByTenant(tenantId)`; sem update/delete |
| `tenants/domain/adminEditableEntitlements.ts` | novo: `ADMIN_EDITABLE_ENTITLEMENT_KEYS = ['marketplace_shein_enabled']` |
| `automation/domain/entities/CapturedOffer.ts` | motivos `MARKETPLACE_PLAN_UNAVAILABLE` e `MARKETPLACE_RISK_NOT_ACCEPTED`, também em `RETRYABLE_REASONS` |
| `automation/domain/contracts/IMonitorPorts.ts` | `TenantLinkResult` (`:7-14`, tipo próprio do módulo) ganha os mesmos kinds `plan_unavailable` e `risk_not_accepted`; `CampaignsMonitorAdapters.ts:13-15` devolve o tipo de campaigns e não compila sem isso |
| `extension/domain/constants.ts` | `SHEIN_SESSION_COOKIES = ['AT', 'memberId']` (paridade com a extensão, travada por teste) |

```ts
export interface SheinSession { token: string; memberId: string }
export interface SheinProductShare {
  affiliateUrl: string;            // info.shareLink; só https em onelink.shein.com — ausente/vazio/outro host → o método devolve null
  title: string | null;            // goodsBasicInfo.goodsName, espaços colapsados
  priceCents: number | null;       // salesPrice vem em REAIS (observado 29.99 com salesPriceText "R$29,99") → Math.round(x * 100); não numérico → null
  originalPriceCents: number | null; // retailPrice ("R$50,00") via parser BRL existente; null se ≤ preço
  imageUrl: string | null;         // mainImageOfOriginImage ?? mainImage, forçado para https
}
export interface ISheinAffiliateClient {
  /** Lança AffiliateCredentialRejectedError (sessão recusada) ou AffiliateApiUnavailableError. null = produto sem link. */
  getProductShare(session: SheinSession, goodsId: string): Promise<SheinProductShare | null>;
}
```

### Infraestrutura

- `campaigns/infrastructure/http/SheinAffiliateClient.ts`
  - URL fixa em constante: `https://m.shein.com/br/affiliate/api/goods/recommend/detailNew`. Nada da URL
    vem de entrada: sem SSRF.
  - Headers: `token`, `siteuid: mbr`, `content-type: application/json`, `User-Agent` igual ao do expansor (`USER_AGENT`, `HttpShortLinkExpander.ts:12`, passa a ser exportada).
    Corpo: `{ language: 'pt-br', playId: 5, goodsId: Number(goodsId), uid: memberId }` (corpo mínimo
    **confirmado na Render em 2026-11-10**: 200 `code "0"` sem `translations`).
  - `redirect: 'manual'`, timeout 8 s, corpo lido com teto de 256 KiB.
  - Mapa de erro: HTTP 401/403 ou `code` `100105` → `AffiliateCredentialRejectedError`; 3xx (desafio de
    risco), 5xx, timeout, JSON inválido → `AffiliateApiUnavailableError('SHEIN')`; `code !== '0'` restante →
    `null` + `logger.warn({ code })`. `code '0'` sem `shareLink` válido também é `null`: o monitor
    enfileira qualquer `kind: 'ok'`, até com link vazio (`ProcessPendingCapturedOffersUseCase.ts:163,201-206`). Rate limit/indisponibilidade **não** pausam a loja (regra atual do builder).
  - Log só com `code`/status. Nunca token, corpo ou URL do produto.
- `campaigns/infrastructure/http/HttpShortLinkExpander.ts`
  - `onelink.shein.com` entra em `SHORT_HOSTS`.
  - Hoje o expansor nunca vê corpo: `request` tenta HEAD primeiro (`:51`), `send` cancela o corpo
    sempre (`:70`) e `expand` devolve a URL atual em status < 300 (`:34`). Para `onelink.shein.com` o
    caminho é próprio: **só GET**, corpo **não** cancelado, lido até 32 KiB; em 2xx extrai
    `<input id="url" value="…">`, desfaz entidades HTML (`&amp;`), valida com `isSupportedProductUrl` e
    **devolve essa URL como final, sem nova requisição** — o laço normal faria HEAD/GET na página do
    produto (`:31-32`), que sem cookie cai em `/risk/challenge` e o plano proíbe. 3xx segue pelo `location` como hoje. Sem `input` →
    devolve a URL atual (vira "produto não reconhecido"). Demais hosts: inalterado (HEAD, corpo nunca lido).
- `campaigns/infrastructure/http/HttpOfferImageFetcher.ts`: `ltwebstatic.com` em `HOST_SUFFIXES`.
- Injeção de `shein` e `entitlements` — nenhuma das duas interfaces tem `entitlements` hoje
  (`BuildTenantAffiliateLinkDeps` `:35-41`, `ResolveAffiliateProductDeps` `:20-25`) —, **obrigatórios** em todos — opcional deixaria o gate
  contornável: `BuildTenantAffiliateLinkUseCase` (`offersContainer.ts:129`), `ResolveAffiliateProductUseCase`
  do container (`offersContainer.ts:141`) e a instância que o `GenerateOfferUseCase` cria por dentro
  (`:73-75`; `GenerateOfferDeps` `:43-55` ganha `shein`, `entitlements` já existe em `:45`).

### Aplicação

**Aceite no uso**: `ResolveAffiliateProductUseCase` e `BuildTenantAffiliateLinkUseCase` só chamam
`getProductShare` com aceite da versão vigente (porta `IMarketplaceRiskGate.isAccepted(tenantId, provider)`
em `campaigns/domain/contracts/`, adapter sobre o repositório de `integrations`). O gate só vale quando **existe credencial**
(sem credencial nada é chamado, e os fluxos "sem credencial" seguem como estão). O gate só roda para provider com
`requiresRiskAcceptance(provider)` verdadeiro (hoje só SHEIN); os outros marketplaces não mudam. Ordem fixa nos dois:
plano → credencial → aceite → chamada. Com credencial e sem aceite: resolver lança
`MarketplaceRiskNotAcceptedError` (403); builder devolve o kind novo `risk_not_accepted` (também em
`IMonitorPorts.TenantLinkResult`), que o monitor trata em ramo próprio com `return` →
`SKIPPED/MARKETPLACE_RISK_NOT_ACCEPTED` (motivo novo, retryable). Não reusar `credential_missing`. **Alerta**: o
aviso do monitoramento hoje nasce de `(!st || !st.usable) && recent.has(provider)`
(`GroupMonitorConfigUseCases.ts:140`), e `recent` só enxerga capturas `CREDENTIAL_MISSING`
(`listRecentMissingProviders`, `PrismaCapturedOfferRepository.ts:178`) — captura com o motivo novo não
alertaria. `credentialAlerts` ganha o tipo `RISK_NOT_ACCEPTED`, alimentado por um método irmão do
repositório que lista providers com captura `MARKETPLACE_RISK_NOT_ACCEPTED` recente (mesma janela);
Regra: um aviso por loja, como hoje — `REJECTED` tem precedência; `RISK_NOT_ACCEPTED` só sem
`rejectedAt`, com `since`/`code` nulos. A união `CredentialAlertDTO.kind` (`GroupMonitorDTO.ts:12`), o enum
do schema (`groupMonitoring.schema.ts:131`) e `CredentialAlertItem.kind` do painel
(`app/src/types/api.types.ts:689-695`) ganham o valor. `CampaignsCredentialStateSource` e `usable` **não** mudam. Texto do alerta no painel
(`features/monitoring/strings.ts`) leva ao card da Shein.
`riskGate` é dependência **obrigatória**, como `shein` e `entitlements`,
nas três instâncias (`offersContainer.ts:129`, `:141`, `GenerateOfferUseCase :73-75`), montado no
container como o `credentialGateway` (`offersContainer.ts:69-78`).

**`requireMarketplaceEnabled(entitlements, tenantId, provider)`** (`campaigns/application/services/`):
sem chave para o provider → libera; `getBoolean(...) !== true` → `PlanFeatureUnavailableError(key)`.
Mesma regra do `requireOfferStoryEnabled`.

**`ResolveAffiliateProductUseCase`** — depois de `detectMarketplace`, chama o gate. Ramo `SHEIN`:

| Situação | Resultado |
|---|---|
| `check === 'not_owned'` | `OfferLinkNotOwnedError` (igual aos outros) |
| sessão presente | 1 chamada `getProductShare`; `affiliateUrl` = link colado se `verified`, senão `shareLink` com `attributionVerified = true` (link gerado pela conta, como o ML em `:63,70-71`); `product` vem da chamada; `products.resolve` **não** é chamado |
| sessão presente, cliente devolve `null` | `verified` → segue com produto vazio; senão `OfferLinkNotAffiliateError` |
| sem credencial (Shein não conectada) | `verifyAffiliateLink` devolve `unverified` para qualquer `affiliate_koc_N` (`:69`, sem identificador para comparar): segue com link colado, `attributionVerified = false`, produto vazio (`productRef` = goodsId) — mesma regra dos outros marketplaces sem credencial. Na Shein credencial e sessão nascem e morrem juntas (o DELETE apaga a linha), então não existe "credencial sem sessão". Gerador/vitrine: preenchimento manual; story lança `OFFER_STORY_PRODUCT_INCOMPLETE` (`RenderOfferStoryUseCase.ts:74`) — aceito |
| sem credencial, `not_affiliate` | `OfferLinkNotAffiliateError` |
| `AffiliateCredentialRejectedError` | propaga como erro da requisição. **Não** pausa a loja aqui: só o builder do monitoramento chama `markRejected` (`BuildTenantAffiliateLinkUseCase.ts:126-127`), como já é com o ML |

`productRefOf` (função exportada de `ResolveProductDataUseCase.ts:29`) ganha `case 'SHEIN': return ref.goodsId`; `resolve` para SHEIN
devolve `{ ...EMPTY_PRODUCT_DATA, productRef: refId }` (padrão da `:83`) sem chamar `pageReader` (página cai em desafio).
`CampaignsMonitorProductReader.read` (`CampaignsMonitorAdapters.ts:56`) não decifra a sessão quando o
provider é SHEIN: o resultado não seria usado.
Segunda barreira: `HttpProductPageReader.read` (`:40-41,55` aceita qualquer host da allowlist) devolve
`null` para host Shein, com teste — nenhum caminho que escape do guard lê a página.

**`BuildTenantAffiliateLinkUseCase`** — novo `kind: 'plan_unavailable'; provider`. Gate depois de
`detectMarketplace`, antes de ler credencial. `case 'SHEIN'`: sem `cred.session?.cookies.AT` →
`credential_missing`; `getProductShare`; `null` → `failed` com `SHEIN_LINK_NOT_CREATED`; ok (o cliente já só devolve `shareLink` https em `onelink.shein.com`; o builder revalida com
`isSupportedProductUrl` antes de devolver `ok` — o monitor trata todo `ok` como link do tenant, `:163,168-170`) →
`sourceUrl` = `https://br.shein.com/product-p-<goodsId>.html` (montada só com o id, como AMAZON `:91` e
SHOPEE `:98`; slug, `/br/` e `-cat-N` da origem não sobrevivem), `affiliateUrl` = `shareLink`, `product`
preenchido. A página de produto responde com desafio "Eu sou humano" até para o dono no navegador dele
(2026-11-10), então `sourceUrl` é **só referência interna** (registro e comparação): nunca é requisitada
pelo servidor nem exibida como link. Todo link clicável ou enviado é o `affiliateUrl` (`onelink`). A T6
confere os consumidores de `sourceUrl`; o que hoje a mostrar como link passa a usar `affiliateUrl` para SHEIN.
O desafio nunca é contornado (ver "O que não fazer").

**`ProcessPendingCapturedOffersUseCase`** — `plan_unavailable` → `SKIPPED` / `MARKETPLACE_PLAN_UNAVAILABLE`
com `data.marketplace`, em ramo próprio **com `return`**, junto de `:161-162`. Sem o `return` o kind cai
em `replacements.set(href, null)` (`:163`): o link some em silêncio, ou vira `UNSUPPORTED_MARKETPLACE` (`:166`).

**`UpsertAffiliateSessionUseCase`**
- `SESSION_PROVIDERS` ganha `'SHEIN'`. **Atenção**: a rota genérica do painel
  `PUT /integrations/affiliate-credentials/:provider/session` (`affiliateCredential.routes.ts:125-151`,
  só `[authHook, tenantHook]`) repassa o corpo a este use case e hoje só é freada por `SESSION_PROVIDERS`.
  Ela passa a recusar provider com `providerIdentifierFollowsSession` com o erro que já existe,
  `AffiliateCredentialInvalidError` (**422**, `AffiliateCredentialErrors.ts:14`): sessão Shein só entra pela
  rota da extensão, que tem consentimento e gate de plano.
- Cookie que identifica troca de token deixa de ser `ssid` fixo: mapa por provider
  (`MERCADO_LIVRE: 'ssid'`, `SHEIN: 'AT'`), aplicado nos **dois** pontos que leem `ssid` — a chamada
  (`:49`) e o `tokenChanged` (`:95-98`, que compara com o `ssid` guardado). Só no primeiro, para a Shein
  `changed` seria sempre true: sem `sessionCheck` no sync v1, `clearRejection` (`:61`) zeraria a recusa a
  cada sync e auditaria `AFFILIATE_SESSION_SYNCED` (`:78`) toda vez.
- Com `providerIdentifierFollowsSession`: o identificador da sessão **substitui** o `publicIdentifier`
  (repo ganha `publicIdentifierOverride`, aplicado no `create` **e** no `update` do upsert —
  `PrismaAffiliateCredentialRepository.ts:105-108`, onde o `update` hoje só leva sessão e rejeição;
  `publicIdentifierIfEmpty` segue só no create/`updateMany` `:113-117`). ML não muda.

**Aceite de risco** (`integrations/application/use-cases/`)
- `AcceptMarketplaceRiskUseCase({ tenantId, userId, role, isSuperAdmin, provider, noticeVersion, locale })`:
  `isSuperAdmin` ou `role !== 'ADMIN'` → 403 (super admin recebe `tenantContext` de qualquer tenant,
  `resolveMembership.ts:26-43`; papéis em `schema.prisma:20-24`); provider sem aviso →
  `AffiliateCredentialInvalidError`; `noticeVersion` ≠ vigente → 409 `MARKETPLACE_RISK_NOTICE_OUTDATED`
  (painel recarrega o texto); grava a linha (ou devolve a existente) e audita `MARKETPLACE_RISK_ACCEPTED`
  com `meta: { provider, noticeVersion }`. Devolve `{ acceptedAt, noticeVersion }`.
- `requireMarketplaceRiskAccepted(repo, tenantId, provider)`: sem linha da versão vigente →
  `MarketplaceRiskNotAcceptedError` (403 `MARKETPLACE_RISK_NOT_ACCEPTED`, em `shared/errors/internal/`).
- `PrismaMarketplaceRiskAcceptanceRepository` na infra do módulo; toda consulta com `tenantId`.

**`UpsertAffiliateCredentialUseCase`** — recusa `PUT` manual para provider com
`providerIdentifierFollowsSession` (`AffiliateCredentialInvalidError`): conexão só pela extensão.

**`DELETE /integrations/affiliate-credentials/:provider`** (genérico, `affiliateCredential.routes.ts:88-99`)
— para provider com `providerIdentifierFollowsSession` responde 409 `USE_MARKETPLACE_DISCONNECT`: apagar
sem revogar o consentimento deixaria o próximo sync da extensão recriar a credencial. O painel desconecta
a Shein só pela rota da extensão. `PATCH` de status (pausar/ativar) segue genérico.

**`ListAffiliateCredentialsUseCase`** — resposta ganha
`marketplaceAvailability: Record<AffiliateProvider, { enabled: boolean; plans: PlanSlug[] }>`:
`enabled` do tenant (`IEntitlementReader`), `riskNotice: { version, acceptedAt: string | null, acceptedByMe: boolean } | null`
(aceite da versão vigente; `null` para provider sem aviso) e `plans` lidos de `plan_entitlement_presets` pelo
`IPlanEntitlementPresetRepository` (novo — hoje não existe repositório, só `tx.planEntitlementPreset`
em `syncPlanEntitlements.ts:18`, `SyncTenantEntitlementsUseCase.ts:10` e no seed): contrato em `tenants/domain/contracts/`, implementação
`PrismaPlanEntitlementPresetRepository` (`listByKeys`, `setForPlan` em transação com os tenants do plano).
Schema `affiliateCredentialListResponse` e presenter (`affiliateCredential.schema.ts:74-86`,
`AffiliateCredentialPresenter.ts:25-31`) declaram o campo novo — sem isso o fast-json-stringify o descarta. Provider sem chave: `{ enabled: true, plans: [] }`.

**Admin — `tenants/application/use-cases/`**
- `ListAdminPlanEntitlementsUseCase`: chaves da allowlist × planos, valor do preset.
- `SetPlanEntitlementUseCase({ planSlug, key, value: boolean, actorUserId })`: valida allowlist e `PLAN_SLUGS`;
  numa transação faz upsert do preset e de `tenant_entitlements` de todos os tenants com aquele `planSlug`;
  grava `AuditLog` (`PLAN_ENTITLEMENT_CHANGED`). Não chama o hub.
- `prisma/seed.ts`: para chaves da allowlist o upsert do preset usa `update: {}` (seed não desfaz a
  decisão do super admin).

### Apresentação

| Rota | Auth | Notas |
|---|---|---|
| `PUT /api/extension/marketplaces/shein/session` | cookie da extensão | corpo `{ cookies: { AT, memberId }, capturedAt }`. `preHandler: [extensionAuthHook]`, `onRequest: [extensionRequestGuard]`; schema de `cookies` com `properties: { AT, memberId }` (string, `maxLength: 4096`), `required: ['AT', 'memberId']` e `additionalProperties: false`. O Ajv do Fastify roda com `removeAdditional: true` (padrão, sem override em `api/src`): chave não declarada é **removida**, não recusada — por isso as duas chaves precisam estar em `properties`, senão o use case receberia `cookies: {}`. Handler fino, **próprio** (o do ML exige `ssid` `:119`, lê `mlConsent` `:145` e chama `mlClient.getActiveTag`): só chama `SyncSheinSessionUseCase` (abaixo). Resposta `{ affiliateId }` (nunca token) com schema próprio na rota (`affiliateSessionSyncResponse`/`toSessionSync` só têm provider/status/updatedAt). Sem checagem na Shein no sync (v1): recusa aparece no uso |
| `POST /api/extension/marketplaces/shein/consent` | Bearer + tenant | corpo `{ installationId }`, igual ao ML (`extension.routes.ts:73-97`): grava `sheinConsentAt` na sessão de (userId, installationId, tenant); sem sessão da extensão → 404 `SESSION_NOT_FOUND`. **Diferente do ML** (`:92` só checa `marketplace_extension`): sem `marketplace_shein_enabled` → 403 `PLAN_FEATURE_UNAVAILABLE` antes de gravar; sem aceite da versão vigente do aviso → 403 `MARKETPLACE_RISK_NOT_ACCEPTED` |
| `POST /api/integrations/affiliate-credentials/:provider/risk-acceptance` | `[authHook, tenantHook]` | corpo `{ noticeVersion, locale }`; chama `AcceptMarketplaceRiskUseCase` com `request.tenantContext` (`{ tenantId, userId, role }`, como as rotas atuais `:76,95` — `request.user` não tem tenant) e a marca de super admin; resposta `{ acceptedAt, noticeVersion }` |
| `GET /api/admin/tenants/:tenantId/marketplace-risk-acceptances` | `[authHook, superAdminHook]` | lista aceites do tenant (provider, versão, usuário, data e hora) |
| `DELETE /api/extension/marketplaces/shein/session` | Bearer + tenant | revoga consentimento, depois **apaga a credencial inteira** (`DeleteAffiliateCredentialUseCase`): `clearSession` manteria o `publicIdentifier`, e na Shein ID sem sessão não serve. Idempotente: `AffiliateCredentialNotFoundError` (`DeleteAffiliateCredentialUseCase.ts:14-15`) vira 204 — consentimento pode existir antes do primeiro sync |
| `GET /api/admin/plan-entitlements` | `[authHook, superAdminHook]` (como `opsMetrics.routes.ts:20`; o segundo lê `request.user`) | lista |
| `PUT /api/admin/plan-entitlements/:planSlug/:key` | `[authHook, superAdminHook]` | corpo `{ value: boolean }`; chave fora da allowlist → 400 |

Rotas `ml/*` ficam como estão (extensão já instalada). Consent e desconexão Shein saem de uma fábrica
parametrizada pelo marketplace, em `extension.routes.ts` (o sync não: handler próprio, acima); consentimento por marketplace no
`IExtensionSessionRepository` (`grantConsent(marketplace, …)`, `revokeConsentForTenant(marketplace, …)`),
com os métodos ML atuais delegando. `sheinConsentAt` entra na entidade `ExtensionSession.ts`, no
`PrismaExtensionSessionMapper` e no `ExtensionSessionContext` do `extensionAuthHook.ts:7-14,39-46`
(`sheinConsent`). **Re-vínculo**: `issue` (`PrismaExtensionSessionRepository.ts:37-51`,
`IssueExtensionSessionUseCase.ts:69-78`) regrava `mlTenantId` e hoje só zera `mlConsentAt`; passa a zerar
`sheinConsentAt` também, senão o consentimento de um tenant valeria no seguinte.
**`SyncSheinSessionUseCase`** (`extension/application/use-cases/`, novo) — ordem fixa:
1. `sheinConsent` do contexto falso → 403 `SHEIN_CONSENT_REQUIRED`.
1b. `requireMarketplaceRiskAccepted(repo, tenantId, 'SHEIN')` → 403 `MARKETPLACE_RISK_NOT_ACCEPTED` (versão do aviso mudou: sync para até o novo aceite; a credencial gravada **não** é apagada, mas gerador e monitoramento também checam — abaixo).
2. `IExtensionEntitlementReader.hasMarketplace(tenantId, 'SHEIN')` falso → `PlanFeatureUnavailableError`.
3. Vínculo: `GetExtensionProfileUseCase.execute(userId, mlTenantId)` (`:25-50`, já filtra tenant por status);
   `profile.tenants.some(t => t.id === mlTenantId)` falso → 403. (`UserTenant` não tem status,
   `schema.prisma:225-237`: vínculo = a linha existir. O `extensionAuthHook :26-37` só valida token/expiração.)
4. Identidade: função pura `sheinSessionMemberId(token)` em `integrations/domain/services/` lê `m` do
   payload do `AT` (2º segmento, base64url JSON — observado na T0, token com 4 segmentos). Ilegível, fora
   do regex ou ≠ cookie `memberId` → `AffiliateCredentialInvalidError` (422). O corpo nunca define o ID.
5. `UpsertAffiliateSessionUseCase.execute({ …, sessionIdentifier: m })` — campo novo em
   `UpsertAffiliateSessionInput` (`AffiliateCredentialDTO.ts:23-37`; hoje só existe `affiliateTag`, que
   preenche ID vazio em `UpsertAffiliateSessionUseCase.ts:43-46`), repassado ao repo como `publicIdentifierOverride`.
6. **Corrida com "Desconectar"**: relê o consentimento por `IExtensionSessionRepository.hasConsent(sessionId, marketplace)`
   (método novo; hoje o contrato `:14-30` não lê consentimento); revogado no meio → apaga a credencial
   recém-gravada e responde 403.

Pré-requisito: a sessão da extensão (`POST /extension/session`) já existe — ela nasce no pareamento atual
(gate `marketplace_extension`, tenant em `mlTenantId`); a Shein não cria sessão própria, só acrescenta o
consentimento. `GET /extension/me`: o schema dos tenants (`extension.routes.ts:322-336`) só declara
`permissions` entre os campos úteis, e é o que a extensão lê (`sessionResolver.ts:53-56`). Então
`GetExtensionProfileUseCase.ts:46` acrescenta `'shein.session'` a `permissions` quando o tenant tem
`marketplace_shein_enabled` — sem campo novo no schema. `IExtensionEntitlementReader` (hoje só
`hasMarketplaceExtension`) ganha `hasMarketplace(tenantId, provider)`, com o adapter inline de
`extension.routes.ts:31`.
Rate limit: `rateLimitPresets.extensionSync`. Handlers async respondem com `return reply…`.

## Extensão

Hoje tudo é valor único do ML (`config/env.ts:34-39`, espelhado em `__mocks__/env.ts`). Vira mapa por
marketplace, mantendo os nomes que o `check-cookie-scope.mjs:52` procura (`MARKETPLACE_COOKIE_DOMAIN…`):

```ts
MARKETPLACES = {
  ml:    { provider: 'MERCADO_LIVRE', MARKETPLACE_COOKIE_DOMAIN: '.mercadolivre.com.br', MARKETPLACE_URL_PATTERN: 'https://*.mercadolivre.com.br/*', MARKETPLACE_URL: 'https://www.mercadolivre.com.br/', cookies: ML_SESSION_COOKIES, tokenCookie: 'ssid', optional: false },
  shein: { provider: 'SHEIN',         MARKETPLACE_COOKIE_DOMAIN: 'm.shein.com',          MARKETPLACE_URL_PATTERN: 'https://m.shein.com/*', MARKETPLACE_URL: 'https://m.shein.com/', cookies: SHEIN_SESSION_COOKIES, tokenCookie: 'AT', optional: true },
}
```

`MARKETPLACE_URL` é a URL concreta que `chrome.cookies.getAll` recebe (`marketplaceSession.ts:15`); o
padrão com `*` só serve a permissão/manifest.
Se o acesso por mapa não casar com a regra do script, a regra do script muda na mesma task (continua
exigindo o domínio do marketplace junto de cada `chrome.cookies.*`).

- **Permissão**: `https://m.shein.com/*` em `optional_host_permissions`, pedida por
  `chrome.permissions.request` em gesto do usuário — host obrigatório novo faria o Chrome desativar a
  extensão de toda a base até o aceite. A extensão não tem popup; o clique no ícone hoje só chama
  `focusOrOpenPanel()` (`background/index.ts:98-100`). Fluxo:
  1. Painel envia a op nova `shein.requestAccess` → extensão grava `pendingAccess: { marketplace: 'shein', until: now+10min }` no storage.
  2. `action.onClicked`: pendência válida → `permissions.request` → concedida: limpa pendência, sincroniza, foca o painel; negada: limpa e foca o painel. Sem pendência: `focusOrOpenPanel()` como hoje.
  3. `shein.status` devolve `{ permission: 'granted' | 'missing', pending: boolean, … }` para o card.

  **Spike na T9**: se `permissions.request` não funcionar a partir desse gesto no service worker, plano
  B = página de opções mínima com o botão; plano C = host obrigatório (aceitando o aviso).
- `marketplaceSession.ts` (único arquivo que **lê** cookies; `index.ts:84` só escuta `onChanged`): lê por marketplace; Shein só com a permissão concedida.
- **Estado de sync por marketplace** — hoje é único e misturaria os dois: `inFlight`
  (`syncSession.ts:37,102-103`), `lastSyncEpoch` (`store.ts:156-160`), `syncState` (`store.ts:84-93`) e
  `SyncErrorCode` (`store.ts:14-25`), o hash de cookies (`mlCookieHash`, `store.ts:46,148-152`, lido e
  gravado em `syncSession.ts:61-62,80`) e `resetStaleSync` (`index.ts:27-32`) passam a ser indexados por
  marketplace. Sync Shein nunca recebe resultado, rate limit nem hash-skip do ML.
  `SyncErrorCode` ganha `shein_not_logged` (sem `AT`): `ml_not_logged` tem texto do Mercado Livre
  (`useExtension.ts:19,23`); mensagem nova em `SYNC_ERROR_MESSAGES`
  — que lê `extensionStrings.errors`, `app/src/features/extension/strings.ts:142-156` — e nos `_locales`
  da extensão.
- `index.ts`: `cookies.onChanged` filtra por domínio **e nome** do cookie de cada marketplace, como hoje
  (`:85-86`, `ML_COOKIE_SET.has`): para a Shein só `AT` e `memberId` agendam sync. Alarmes por marketplace.
  `sessionResolver.ts`: permissão `shein.session` em `permissions` do `/extension/me`.
- **Erros**: `apiFetch.ts:73` hoje converte todo 403 em `forbidden`. Passa a ler `error.code` do envelope
  antes do status: `ML_CONSENT_REQUIRED`/`SHEIN_CONSENT_REQUIRED` → `consent_required`;
  `PLAN_FEATURE_UNAVAILABLE`/`EXTENSION_NOT_ENTITLED` → `plan_unavailable`; `MARKETPLACE_RISK_NOT_ACCEPTED` →
  kind novo `risk_not_accepted` (em `SyncErrorCode`, `_locales` e `features/extension/strings.ts`) (os kinds já existem em
  `store.ts:17-18` e as chaves `err_*` nos `_locales`, sem produtor hoje). O texto de `consent_required` no painel cita o
  Mercado Livre (`features/extension/strings.ts:151`): vira texto por marketplace.
- **Canal**: ops `shein.status`, `shein.syncSession`, `shein.requestAccess`; `caps` (fixo em
  `channel/handlers.ts:27`) vira `['ml.session', 'shein.session']`; guard (`channel/guard.ts:17-18,49-58`)
  ganha `SHEIN_OPS` com a mesma exigência de tenant + permissão das `ML_OPS`, por um
  `hasPermission(profile, perm)` genérico — `hasMlPermission` (`sessionResolver.ts:53-56`) é fixo em
  `'ml.session'` e não serve à Shein;
  `BLOCKED_FIELDS` ganha `AT` e `token` (`sanitize.ts:18` **remove** a chave). `CHANNEL_VERSION` não muda
  (só adição). O contrato tem espelho no painel — `app/src/features/extension/contract/channel.ts` —
  que muda idêntico (`check-contract-sync.mjs:15-16`).
- `webpack.js` (`buildHostPermissions` + opcional; ele sobrescreve a versão do manifest, `:135`), scripts
  `check-cookie-scope`, `check-contract-sync`, `check-dist`, teste `cookie-parity`, `_locales/*`.
- Versão **3.4.0** em `extension/package.json` e `manifest.json` (hoje 3.3.0 × 3.0.0; `check-dist.mjs:35`
  exige igualdade) + `extension/CHANGELOG.md`.

## Painel

- `services/affiliateCredential.service.ts:14-16` hoje devolve só `items`: passa a devolver também
  `marketplaceAvailability`, lido em `features/settings/hooks/useAffiliateCredentials.ts:38-47`.
- `types/api.types.ts`: `'SHEIN'`, `marketplaceAvailability` e `MARKETPLACE_PLAN_UNAVAILABLE` e `MARKETPLACE_RISK_NOT_ACCEPTED` no union
  `CapturedOfferReason` (`:714-716`; sem ele o `satisfies Record` de `monitoring/strings.ts:455-466` não compila).
- `features/settings/affiliateProviders.ts`: entrada Shein com `usesBrowserSession: true` (campo que já
  existe, `:48`) e o novo `identifierFromSession: true`; `publicField` (`:44`) passa a opcional. Consumidores
  que leem `spec.publicField.*` direto passam a tratar ausência: `AffiliateCredentialCard.tsx:128`,
  `AffiliateCredentialDialog.tsx:56,186,189,196`. Ícones dos destaques da entrada Shein por
  `AppIcon`/Lucide: o campo `icon` é `SvgIconComponent` (`:26`, tipo MUI) e vira união MUI | Lucide no
  mesmo passo (os outros marketplaces não migram nesta feature). Logo em `app/public/assets/marketplaces/` + `LICENSE.md`.
- `BrowserSessionCredentialDialog` é só ML hoje (`ext.syncMl`, `ext.mlCredential`, `:44,98-114`) e é
  aberto por `AffiliateCredentialsPage.tsx:94`: recebe o marketplace por prop e `useExtension` ganha
  `sync(marketplace)`, `requestAccess(marketplace)`, `disconnect(marketplace)` e `supports(cap)` =
  `handshake.caps.includes(cap)` (`useExtension.ts:47,81-88`; hoje ninguém lê `caps`). Com
  `identifierFromSession` o diálogo não mostra campo de ID. A credencial também passa a ser por provider:
  hoje `refresh()` e o diálogo só conhecem a do ML (`useExtension.ts:133-137`,
  `extensionApi.ts:82` `getMlCredentialStatus`, `BrowserSessionCredentialDialog.tsx:54-55,112-116`
  `ext.mlCredential`) e julgariam o sync da Shein pelo registro do ML.
- **Aviso de risco** (SHEIN-18): faixa fixa no card Shein em todo estado com plano liberado — sem extensão, sem vínculo, pronto,
  conectado, recusada, reaceite (só o estado "travado por plano" não mostra)
  (`Alert severity="warning"`, ícone Lucide via `AppIcon`), com resumo e link "ler aviso completo". O
  texto vive em `features/settings/strings.ts` (i18n) e diz, sem suavizar: os termos da SHEIN proíbem
  bots e ferramentas automatizadas; a SHEIN pode encerrar a conta de afiliado e reter comissões; o uso é
  por conta e risco do titular da conta; a plataforma não responde por bloqueio ou perda. Redação final
  com a skill de copywriting, sem mudar o conteúdo. Quando `riskNotice.acceptedAt` existe, a faixa mostra
  "Aceito em <data e hora local>", com "por você" quando `acceptedByMe`.
- **Diálogo de aceite**: "Conectar Shein" abre o texto completo com caixa "Li e assumo o risco" desmarcada
  e botão desabilitado até marcar; confirmar chama `risk-acceptance` com a versão exibida e só então
  `/consent`. 409 `MARKETPLACE_RISK_NOTICE_OUTDATED` → recarrega o texto. A caixa de aceite **não** vai
  para `usePersistedState` (aceite não pode sobreviver a reload sem novo clique) — exceção à regra de
  persistência, registrada na tabela de `docs/padrao-ui-painel.md:34-50` na T15. Operador vê o texto com
  o botão desabilitado e a dica "só administrador aceita".
- Card Shein em `/affiliates/credentials` (6 estados):
  - travado (`enabled === false`): `PlanAvailabilityBadges` com `plans` da API + link `/plans`;
  - sem extensão / extensão sem `shein.session`: instrução de instalar/atualizar;
  - extensão instalada mas sem vínculo: detectado **só** por `isConnected` falso (`useExtension.ts:88`),
    nunca sondando `/consent` — essa rota grava consentimento quando a sessão existe, e consentimento só
    nasce do clique em "Conectar Shein". Instrução de vincular a extensão ao painel, mesmo caminho do ML.
    Segundo gatilho: o clique em "Conectar Shein" voltar 404 `SESSION_NOT_FOUND` (sessão da extensão é de
    outro usuário do painel; `isConnected` segue true) liga uma flag local do card, que zera no próximo
    `refresh()` bem-sucedido do `useExtension`;
  - pronto: botão "Conectar Shein" **abre o diálogo de aceite**; confirmado, a sequência é
    `risk-acceptance` → `/consent` com `installationId` → `shein.requestAccess` → orientação do clique no
    ícone. Aceite vigente já gravado: o diálogo é pulado e a sequência começa em `/consent`.
    **Espera pelo clique**: a permissão e o sync acontecem no service worker e nada avisa o painel
    (recarga hoje só em `onClose`/`onSynced` do diálogo, `AffiliateCredentialsPage.tsx:98-99`, e após ação
    do próprio painel, `useExtension.ts:124-129`). Enquanto `shein.status` devolver `pending: true`, o card
    consulta `shein.status` a cada 3 s com `setTimeout` encadeado (sem
    `setInterval`), no máximo pelos 10 min da pendência; `permission: 'granted'` + sync concluído →
    recarrega `affiliateCredentialService.list()` e vai para "conectado"; pendência expirada ou permissão
    negada → volta a "pronto" com aviso;
  - conectado: ID de afiliado (com `Blurred`, flag nova em `privacyFlags.ts`), "Sincronizar agora", "Desconectar".
    "Desconectar" **não** usa o `remove` genérico (`AffiliateCredentialsPage.tsx:75` →
    `affiliateCredential.service.ts:24-25`, que dá 409 para SHEIN): usa `disconnect('shein')`, novo em
    `features/extension/services/extensionApi.ts` ao lado do `disconnectMl` (`:95-96`) e exposto por
    `useExtension` (`:141-142`). A lixeira do card (`AffiliateCredentialCard.tsx:184-196,209-211` →
    `onRemove`) segue o mesmo caminho para provider com `identifierFromSession`: chama `disconnect`, nunca `remove`;
  - recusada: aviso "entre de novo na Shein";
  - conectado com aviso em versão nova (`riskNotice.acceptedAt === null` e credencial existente): card
    pede novo aceite; sync e geração ficam parados até lá.
- `PlanAvailabilityBadges` hoje recebe `from="max"`: ganha a forma `plans={[…]}` sem quebrar a atual.
- Strings: `features/settings/strings.ts`, `features/storefront/{types,strings}.ts`,
  `features/monitoring/strings.ts` (rótulo do marketplace + motivos `MARKETPLACE_PLAN_UNAVAILABLE` e `MARKETPLACE_RISK_NOT_ACCEPTED` + alerta `RISK_NOT_ACCEPTED`),
  `features/offers/utils/offerStore.ts` (hosts), `features/subscription/strings.ts` (`SUBSCRIPTION_LIMIT_KEYS` `:17-38` e `marketplace_shein_enabled: 'max'` em `FIXED_MIN_PLAN` `:61-70`, senão `minPlanFor` devolve null) e
  `tenants/domain/services/subscriptionLimits.ts` (linha do recurso), `features/plans/catalog.ts` (benefício MAX).
- Admin: `pages/admin/AdminPlanEntitlementsPage.tsx` em `/admin/plan-entitlements` — tabela chave × plano
  com `<Switch>`; entrada na seção `platform` (`features/navigation/model.ts:129-136`, protegida pelo ternário `isSuperAdmin`) e
  rótulo em `features/navigation/strings.ts`.
- Tooltips, i18n, claro/escuro, `usePersistedState` onde houver estado de trabalho (a tela admin não tem rascunho).

## Documentação

`docs/afiliado-shein.md` (como funciona, o que é observado × garantido, o que não fazer), linha no
`AGENTS.md`, `docs/integracoes-credenciais-afiliado.md`, `docs/extensao-navegador.md`,
`docs/produto-roadmap.md` (tabela Marketplaces), `docs/gerador-de-ofertas.md`, `api/CHANGELOG.md`,
`extension/CHANGELOG.md`.

## O que não fazer

- Não resolver, pular nem automatizar o desafio anti-bot da Shein (`/risk/challenge`), em servidor ou extensão.
- Não ler página de produto Shein nem chamar outro host da Shein além dos três da allowlist e do endpoint fixo.
- Não enviar headers anti-bot forjados (`armortoken`, `smdeviceid`, `x-oest`): se a Shein passar a exigir, o recurso para e volta para decisão.
- Não montar link de afiliado à mão (`url_from`) como se rendesse comissão.
- Não devolver, logar nem pôr em evento o `AT`; não guardar fora de `sessionCiphertext`.
- Não aceitar `memberId` digitado: o ID vem da sessão.
- Não apagar nem alterar linha de `marketplace_risk_acceptances`; não marcar aceite por padrão, por seed,
  por migration nem por super admin em nome do tenant.
- Não suavizar o aviso: precisa citar proibição nos termos, encerramento de conta e perda de comissão.
- Não liberar plano por código: preset + rota admin.
- Não trocar o `CMD` nem rodar migration local (`api/.env` = produção).
