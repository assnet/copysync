# Acesso por produto — Design

**Spec**: `spec.md` · **Status**: Aprovado (2026-11-11)

## 1. Visão

```
central ──webhook(planSlug, permissions)──▶ ApplyBillingEvent ──▶ resolvePlan ─▶ {product, planSlug}
                                   │                                   │
                                   ├─ AFFILIATES: caminho de hoje ─────┤ (Tenant.planSlug, entitlements)
                                   └─ produto novo: tenant_products ───┘ (linha + preset do plano)

requisição ─▶ authHook ─▶ tenantHook ─▶ productGate(produto da rota) ─▶ handler
                                            │ off: não consulta
                                            │ log: consulta, registra would_block
                                            └ enforce: 403 PRODUCT_UNAVAILABLE

painel ─▶ GET /tenants (tenants[].products) ─▶ buildNavigation · ProductRoute · rota inicial
```

Regra central (função pura, sem banco):

```ts
// api/src/modules/tenants/domain/services/resolveProductAccess.ts
export const PRODUCTS = ['AFFILIATES', 'CHAT', 'SAVER'] as const;
export type ProductKey = (typeof PRODUCTS)[number];
export const LEGACY_PRODUCTS: readonly ProductKey[] = ['AFFILIATES', 'CHAT'];
// row ausente: legado = true, novo = false. Row presente: status === 'ACTIVE'.
export function resolveProductAccess(product: ProductKey, row: { status: 'ACTIVE' | 'INACTIVE' } | null): boolean;
// CHAT não tem plano próprio: quem chama resolve CHAT pela linha de AFFILIATES (ACCESS_FOLLOWS = { CHAT: 'AFFILIATES' }).
// Nenhuma linha CHAT é gravada nesta versão.
```

## 2. Banco

```prisma
model TenantProduct {
  id        String   @id @default(cuid())
  tenantId  String
  product   String   // ProductKey; String (não enum) para produto novo não exigir ALTER TYPE
  status    String   // ACTIVE | INACTIVE
  planSlug  String?  // plano do produto (ex.: SAVER_LITE); null em produto legado desligado
  expiresAt DateTime?
  source    String   // BILLING | ADMIN
  inactiveSince DateTime? // preenchido ao virar INACTIVE, limpo ao voltar; base do expurgo de dados do produto
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, product])
  @@map("tenant_products")
}
```

- Migration `create_tenant_products`: só `CREATE TABLE` + índice único. **Sem backfill, sem INSERT.**
- Migration separada `add_audit_action_tenant_product_changed` (`ALTER TYPE "AuditAction" ADD VALUE`; padrão do projeto: valor de enum em migration própria).
- `Tenant.planSlug` e `Tenant.subscriptionExpiresAt` continuam sendo o plano e o vencimento de **Afiliados**. Não renomear.

## 3. API

### 3.1 Domínio (`tenants/domain`)
- `services/resolveProductAccess.ts` (acima) + teste.
- `planCatalog.ts`: `resolvePlan(planSlug, permissions): { product: ProductKey; planSlug: string } | null`. Para Afiliados delega a `resolveEffectivePlanSlug(planSlug, permissions)` (inalterada; permissão reconhecida vence o slug, `planPresets.ts:40-50`); produto novo sai do slug ou de permissão própria (`SAVER_{TIER}`) e acrescenta a família Saver: `copysync-saver-{tier}-{mensal|anual}` e o interno `SAVER_{TIER}`. Os tiers vêm de `SAVER_PLAN_SLUGS` (definidos na feature `saver`; aqui entra a estrutura e um tier de teste).
- `sharedEntitlements.ts`: `SHARED_KEYS = [whatsapp_sessions, telegram_sessions]` e `mergeSharedEntitlements(presetsPorProdutoAtivo): Record<key, number | null>` (maior vence; `null` vence tudo).
- `contracts/IProductAccessReader.ts`: `has(tenantId, product)`, `list(tenantId): ProductKey[]`.
- `contracts/ITenantProductRepository.ts`: `find`, `findAll`, `upsert`, (todas com `tenantId`).

### 3.2 Infraestrutura
- `tenants/infrastructure/repositories/PrismaTenantProductRepository.ts` + `PrismaTenantProductMapper.ts`; aceita `TransactionClient` (o webhook grava na própria transação).
- `tenants/infrastructure/access/CachedProductAccessReader.ts`: cache em memória por processo, TTL 45 s, chave `tenantId`. É cache de leitura do banco (mesma natureza do `CachedChatEntitlementGate.ts`), não estado operacional: reinício só esfria o cache.

### 3.3 Gate HTTP
- `shared/errors/internal/PlanErrors.ts`: `ProductUnavailableError` (403, `PRODUCT_UNAVAILABLE`, `meta.product`).
- `shared/config/env.ts`: `PRODUCT_ACCESS_GATE_MODE` (`off|log|enforce`, padrão `off`; precedente: `LOGIN_GUARD_MODE`).
- `shared/http/hooks/productGate.ts`: `createProductGate(product, reader, mode)` devolve `preHandler` **async que lança `AppError`** (regra do AGENTS §14: nunca `send` + `return;`). Sem `request.tenantContext` (rota pública do plugin) = não faz nada. Super admin passa.
- `app/productRoutes.ts`: `withProduct(product, plugin)` devolve um plugin que registra `onRoute` no escopo encapsulado e insere o gate **logo após `tenantHook`** (antes de portões por rota como `offerHunterAudienceHook`, `offerHunt.routes.ts:18`, para tenant sem o produto receber `PRODUCT_UNAVAILABLE`, não `OFFER_HUNTER_UNAVAILABLE`). **Nunca `push`**: os módulos compartilham um único `const preHandler` por arquivo (`chat.routes.ts:91`, `offer.routes.ts:28`, `linkRotation.routes.ts:25`; em `storefront.routes.ts:36` é a função `preHandler = () => [...]`), então mutar o array empilharia o gate N vezes. Sempre array novo: `routeOptions.preHandler = inserirApósTenantHook(normalizado(atual), gate)` (aceita `undefined`, função ou array). Rota sem `tenantHook` no próprio `preHandler` não recebe o gate. `ROUTE_PRODUCT_MAP` declara cada módulo de `routes.ts`:

| Classe | Módulos (`routes.ts`) |
| --- | --- |
| `AFFILIATES` | offers, offer-hunts (caçador + sugestão IA, `routes.ts:118-119`), send-queue, broadcast-groups, group-monitoring, link-rotation, storefront, offer-story, affiliate-credentials, extension (rotas de tenant), ai do tenant |
| `CHAT` | chat, WebSocket do chat |
| `SAVER` | saver (feature `saver`) |
| `TENANT` (sem gate) | auth, tenants, me, users, sessions, subscription, media/uploads, provisioning, billing, admin/*, públicas |

A tabela acima é o ponto de partida; a T5 confere linha a linha contra `routes.ts` e o teste de classificação trava o resultado.

- Produto novo (`SAVER`) é **sempre** exigido, independentemente do modo: o modo só governa os produtos legados.
- Em `off` e `log` nenhuma rota legada é bloqueada, nem para tenant com linha `AFFILIATES` inativa. Consequência assumida: tenant só-Saver só pode existir em produção com `enforce`. `SetTenantProductUseCase` e o provisionamento de produto novo emitem log `error` se o modo não for `enforce`.
- Rotas da extensão autenticadas por cookie não têm `tenantContext` (`extensionAuthHook.ts:49-57`, tenant em `extensionSession.mlTenantId`): o gate por `onRoute` não as alcança. Elas checam o produto dentro do módulo `extension`, pelo `mlTenantId` (T15).

### 3.4 Billing (`integrations/billing`, `integrations/domain/services`)

Mudança mínima no fluxo existente; o caminho de Afiliados não muda de ordem nem de escrita.

- O nível hoje sai de `resolveEffectivePlanSlug(planSlug, permissions)` (`ApplyBillingEventUseCase.ts:223-231`); passa a sair de `resolvePlan(planSlug, permissions)` e carrega `{product, planSlug}`.
- `unknownPlanPermissions` (`subscriptionReconcile.ts:101`) passa a ignorar permissões de produtos conhecidos (`ALL_PLAN_SLUGS`), senão todo evento Saver gera `warn`.
- `provisionIfUnknown`: plano de produto novo deixa de ser `invalid_plan_slug`. `ProvisionTenantUseCase` ganha `initialProducts?: { product, planSlug }[]`; com produto novo, cria o tenant com `planSlug` nulo e grava, na mesma transação, a linha do produto ativo e a linha `AFFILIATES` inativa (cliente novo nunca teve Afiliados; `CHAT` acompanha).
- Consulta à central fora da transação (`needsUnionLookup`): hoje só eventos de corte. Passa a valer também para **ativação/renovação de produto novo em tenant que não está `ACTIVE` e não tem linha `AFFILIATES`** (PROD-14). Central fora = `HUB_UNAVAILABLE` (503, sem recibo), igual ao corte.
- `applyInTx`:
  - `product === 'AFFILIATES'`: código de hoje, sem alteração. Extra: se existir linha `AFFILIATES` (só existe em tenant que já foi multi-produto), atualiza para ativo e limpa `inactiveSince`.
  - produto novo:
    - `subscription.activated`/`renewed`: `unblock()` como hoje (`ACTIVATING`, `ApplyBillingEventUseCase.ts:106`). Se veio snapshot (caso PROD-14): `AFFILIATES` inativo **somente se** `legacyGrants === false` (definição abaixo).
    - `subscription.updated`: não mexe em status (não está em `ACTIVATING`); só plano/vencimento da linha.
    - sempre: upsert da linha do produto (ativo, plano, vencimento); `syncPlanEntitlements(tx, tenantId, planSlug, { excludeKeys: SHARED_KEYS })`; **não** escreve `data.planSlug` nem `data.subscriptionExpiresAt`.
  - evento de corte: `pickGrantingByProduct` (abaixo). Tenant ativo se `anyGrants` (inclui plano desconhecido, como hoje).
    - Produto novo: dá acesso → sincroniza; não dá → linha inativa + `inactiveSince`.
    - `AFFILIATES`: dá acesso → caminho de hoje (`syncSlug`). Não dá: grava linha inativa **somente se** `legacyGrants === false` **e** algum produto novo dá acesso. Com plano desconhecido dando acesso, nada muda para Afiliados (comportamento de hoje, `KEPT_ACTIVE` sem escrita).
    - Ninguém dá acesso → `block()` de hoje; não cria linha `AFFILIATES`; linhas de produto novo existentes viram inativas (PROD-16).
  - depois de qualquer mudança de produto: `mergeSharedEntitlements` e upsert das chaves compartilhadas (PROD-18). Único ponto que escreve `whatsapp_sessions`/`telegram_sessions` por causa de produto novo.
- `subscriptionReconcile.ts`: nova `pickGrantingByProduct(subs, now, grace)` (classifica cada assinatura por `resolvePlan(s.planSlug, s.permissions)`, como `pickGrantingSubscription` já usa as permissões, `:114-130`) → `{ byProduct: Map<ProductKey, {grants, sub, planSlug}>, unknownGrants: boolean, anyGrants: boolean }`. `legacyGrants = byProduct.AFFILIATES.grants || unknownGrants`: assinatura que dá acesso com plano que o CopySync não conhece conta **a favor de Afiliados**, porque é assim que o tenant é mantido hoje (`ApplyBillingEventUseCase.ts:419-428`). `pickGrantingSubscription` mantém assinatura e retorno atuais (teste de caracterização). `decideReconcile`: os ramos atuais ficam; `unknown_plan` continua sem escrita; decisão ganha `products` só quando há assinatura de produto novo.
- `PrismaBillingReconcileRepository`: aplica as linhas de produto na mesma transação; linha `source=ADMIN` nunca é desativada (PROD-22). A fila de "vencidos" (`:56-59`, por `subscriptionExpiresAt`) exclui tenant com linha `AFFILIATES` inativa, senão ele ocuparia o lote para sempre (PROD-28).
- `syncPlanEntitlements` ganha o parâmetro opcional `excludeKeys` (padrão vazio = comportamento de hoje). Sem isso o upsert do preset Saver gravaria `whatsapp_sessions: 1` em tenant legado ilimitado antes do merge (`syncPlanEntitlements.ts:19-25`; `CreateSessionUseCase.ts:43-48`).
- Validação de plano no admin (`SetPlanEntitlementUseCase.ts:38`, `ListAdminPlanEntitlementsUseCase.ts:26-28`) passa a aceitar `ALL_PLAN_SLUGS` (Afiliados ∪ produtos novos); `PLAN_SLUGS` segue só Afiliados para a ordenação de tier. A propagação (`PrismaPlanEntitlementPresetRepository.ts:45`, `tenant.findMany({ where: { planSlug } })`) não alcança tenant de produto novo (`Tenant.planSlug` nulo): para plano de produto novo, propaga por `tenant_products.planSlug` (linha ativa), pula `SHARED_KEYS` e roda o merge (PROD-18).

### 3.5 Segundo plano e públicas (PROD-20)
Inventário real (T13). Regra única: só o modo `enforce` filtra; `off` e `log` não consultam nada aqui (`log` já mede `would_block` nas rotas HTTP; repetir por mensagem/clique só geraria ruído). Composição em `productAccessContainer.ts`: `backgroundProductAccessReader()` devolve `AlwaysGrantedProductAccessReader` fora de `enforce` e, em `enforce`, o leitor com cache envolvido em `FailOpenProductAccessReader` (falha de leitura = liberado + `warn`, como o gate do chat). Onde o tenant suspenso já é filtrado em SQL (fila), o filtro de produto entra no mesmo SQL (`affiliatesInactiveFilter.ts`, `Prisma.empty` fora de `enforce`): item fica na fila, sem falha e sem laço. Produto inativo = linha `AFFILIATES` com `status <> 'ACTIVE'` (legado sem linha = ativo, `resolveProductAccess`).

| Ponto (arquivo:linha) | Tratamento atual de tenant suspenso | Mudança (T14/T15) |
| --- | --- | --- |
| Rodízio público `ResolvePublicLinkUseCase.ts:88` | `tenantActive` falso → `unavailable` | `AFFILIATES` inativo → `unavailable` (dep opcional `products`) |
| Vitrine pública `RenderPublicStorefrontUseCase.ts:23` | `tenantActive` falso → 503 genérica | idem → 503 genérica |
| Envio de ofertas: claim `PrismaOfferDispatchRepository.ts:193` | SQL: `status = 'ACTIVE'`; envio fica `QUEUED` | mesmo SQL exclui tenant com `AFFILIATES` inativo (fica `QUEUED`) |
| Sync de membros do rodízio `PrismaLinkRotationMemberSyncStore.ts:33` | `tenant: { status: 'ACTIVE' }` no `findMany` | mesmo `where` com `tenantProducts: { none: inativo }` |
| Captura do monitoramento `GroupMonitoringMessageListener.ts:14` → `RegisterCapturedMessageUseCase.ts:45` | nenhum filtro; sessão do suspenso é desconectada (`TenantSuspendedSessionListener.ts:18`, `InactiveTenantSessionSweepJob.ts:23`) e não gera evento | sessão segue conectada (é do tenant): grupo encontrado + produto inativo → `ignored` (não grava captura) |
| Processamento de capturas `PrismaCapturedOfferRepository.ts:58` | nenhum filtro | nenhuma: sem captura nova; pendente antiga vira oferta barrada no claim do envio |
| Caçador `PrismaOfferHuntRepository.ts:92` (`OfferHuntSchedulerJob`) | nenhum filtro | nenhuma (mesmo tratamento do suspenso; envio barrado no claim). Candidato a filtro futuro se o custo externo pesar |
| Chat: `ChatIncomingMessageListener.ts:21`, `ChatMessageStatusListener.ts:53,57`, `ChatMessageReactionListener.ts:24`, `ChatPresenceListener.ts:19`, `ChatContactAvatarListener.ts:21`, `ChatGroupAvatarListener.ts:22`, `ChatConversationStateListener.ts:58`; histórico `localEngineContainer.ts:38` | sessão desconectada; gate `chat_enabled` só com `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED` | `chatIngestComposition` compõe `ProductAwareChatEntitlementGate` (`CHAT` acompanha `AFFILIATES`) em `enforce`, com ou sem a flag: chat desligado = só contato (regra de hoje do gate) |
| `ChatSessionStatusListener.ts:11,22,33` | só publica status da sessão no WS | nenhuma (status é da sessão, do tenant; WS já barrado no upgrade, T7) |
| Extensão por cookie `extension.routes.ts:184` (ML) e `:275` (Shein) | nenhum filtro de status (só entitlement) | `extensionAffiliatesHook` após `extensionAuthHook`: 403 `PRODUCT_UNAVAILABLE` pelo `mlTenantId` |
| Extensão por cookie `:397` (`DELETE /session`), `:423` (`GET /me`), `:478` (`/heartbeat`) | nenhum filtro | nenhuma: logout nunca bloqueia; perfil e heartbeat são da instalação/conta (sem dado de Afiliados) |
| `HubOutboxWorker.ts:23`, `ExtensionRetentionJob.ts:20` | nenhum filtro | nenhuma (telemetria da instalação e retenção) |
| `TenantSuspendedSessionListener.ts:18`, `InactiveTenantSessionSweepJob.ts:23`, `SessionAdoptionResetListener.ts:24` | desconectam/adotam sessão | nenhuma: sessão é do tenant, não do produto |
| `/redirect/<slug>` (`publicRedirectRoutes`) | sem tenant | nenhuma (link da plataforma) |

### 3.6 Admin e leitura
- `PUT /admin/tenants/:tenantId/products/:product` (`superAdminHook`): `{ status, planSlug? }` → `SetTenantProductUseCase` (valida produto e plano, grava `source=ADMIN`, sincroniza preset, merge de compartilhadas, `AuditLog`). `planSlug` obrigatório ao ligar produto novo. `CHAT` não é aceito (acompanha `AFFILIATES`).
- `products: ProductKey[]` (via `IProductAccessReader.list`; aditivo) em **`GET /tenants`** (`ListUserTenantsUseCase` + `TenantPresenter`, `tenant.routes.ts:28`) (fonte única do painel: `finishLogin` chama `loadTenants()`, `LoginPage.tsx:76-85`); a resposta do login pode ganhar o campo, opcional. `GET /me` ganha o mesmo campo por coerência (o painel não o chama: `tenantService.getMe` não tem chamador).
- `GET /subscription`: `products: [{ product, planSlug, tier, expiresAt, source }]` aditivo; os campos atuais continuam descrevendo Afiliados.

## 4. Painel

- Fonte dos produtos: `TenantContext` (`app/src/contexts/TenantContext.tsx:24,32`), alimentado só por `GET /tenants` (o login apenas grava o tenant ativo e chama `loadTenants()`, `LoginPage.tsx:76-85`). No reload a lista começa vazia: o contexto expõe `tenantsLoaded` e, enquanto for `false`, menu de produtos e guards mostram carregamento. O padrão legado (`['AFFILIATES','CHAT']`) só se aplica a tenant **carregado** sem o campo `products` (API antiga).
- `features/products/`: `productAccess.ts` (tipo `ProductKey`, `hasProduct`, `PRODUCT_HOME`, `PRODUCT_PLANS_PATH`, `resolveHomePath`), `useProductAccess()` (lê do `TenantContext`; devolve `{ loaded, products }`), `ProductRoute.tsx` (carregando → indicador; sem acesso → `Navigate` para a vitrine do produto), `strings.ts`.
- `resolveHomePath(products)`: com Afiliados = `/dashboard` (hoje); senão o primeiro produto com entrada em `PRODUCT_HOME`; sem nenhum = `/settings/subscription`. `PRODUCT_HOME.SAVER` só é registrado pela feature `saver` (antes disso a rota `/saver` não existe e o fallback `*` de `AppRoutes.tsx:141` entraria em laço).
- Redirecionamentos fixos a trocar por `resolveHomePath` / vitrine do produto: `AppRoutes.tsx:57,87,141`, `LoginPage.tsx:85`, `AppLayout.tsx:488`, `features/ai/components/SuperAdminRoute.tsx:7`. Links de upsell para a vitrine de Afiliados (passam a usar `PRODUCT_PLANS_PATH`): `features/storefront/planGate.ts:6`, `features/linkRotation/planUpsell.ts:56`, `features/subscription/components/SubscriptionPlanCard.tsx:60`, `WizardProviderStep.tsx:86`, `HunterGatesPanel.tsx:39`, `OfferSendPanel.tsx:134`, `OfferConfigWizard.tsx:200`, `GroupPickerDialog.tsx`, `AccountIdentifiersSection.tsx:18`, `features/settings/components/SheinCredentialCard.tsx:406` (`navigate('/plans')`) (`features/plans/planGate.ts` só detecta o erro). A T20 faz um `grep` final por `'/dashboard'`, `'/plans'` e `AFFILIATE_PLANS_PATH` e justifica cada ocorrência restante.
- `/settings/ai` e `/settings/extension` (`AppRoutes.tsx:120-121`) consomem rotas classificadas `AFFILIATES`: saem do menu de Configurações e ficam sob `<ProductRoute product="AFFILIATES">` (PROD-29).
- `features/navigation/model.ts`: `BuildNavigationInput` ganha `products: ProductKey[]` ao lado de `offerHunterVisible`; `NavProduct` ganha `locked?: boolean`. Produto `available` sem acesso → `locked`, `children` = só o item de planos. `model.test.ts` cobre legado (igual a hoje), só-Saver e ambos.
- `AppLayout.tsx:329`: passa `products`. Acordeão: produto travado mostra `AppIcon` de cadeado com `Tooltip`.
- `AppRoutes.tsx`: rotas de Afiliados sob `<ProductRoute product="AFFILIATES">`; index e fallback usam `resolveHomePath(products)` (com Afiliados = `/dashboard`, como hoje).
- `LoginPage.tsx:85`: destino pós-login via `resolveHomePath`.
- `DashboardPage.tsx`: `ExtensionInstallBanner` só com `AFFILIATES`.
- `services/apiClient.ts`: 403 `PRODUCT_UNAVAILABLE` → vitrine do produto (ao lado do tratamento de `TENANT_SUSPENDED`, `apiClient.ts:236-238`).
- `SubscriptionPage` / `features/subscription/components/SubscriptionPlanCard.tsx`: um cartão por produto; `SubscriptionLimitsTable.tsx` filtra chaves pelo produto (as chaves por produto vêm da API, `tenants/domain/services/subscriptionLimits.ts`).
- Tenant carregado sem `products` (API antiga) = `['AFFILIATES','CHAT']`: deploy do painel antes ou depois da API não quebra.

## 5. Erros

| Cenário | Tratamento | O que o usuário vê |
| --- | --- | --- |
| Rota de produto sem acesso (`enforce`) | 403 `PRODUCT_UNAVAILABLE` | Vitrine de planos do produto |
| Leitura de produto falha | `enforce`: 503 genérico (nunca libera produto novo); `log`/`off`: segue | Mensagem genérica de indisponibilidade |
| Plano de produto desconhecido no webhook | como hoje: aviso e plano não aplicado; cliente novo = 422 | Nada (central retém o evento) |
| Admin informa plano de outro produto | 400 de validação | Erro no formulário |

## 6. Implantação

1. Deploy com `PRODUCT_ACCESS_GATE_MODE=off` (padrão). Nada muda.
2. `log` na Render por ≥ 48 h. Conferir: zero `would_block` em tenants existentes; `SELECT count(*) FROM tenant_products` coerente (somente leitura).
3. `enforce`. Enquanto não existir tenant com produto novo, reversão = voltar a `off` (sem migration de volta; a tabela pode ficar).
4. Só então a feature `saver` vai a produção, o super admin concede o Saver a pilotos e os planos Saver são cadastrados na central.
5. Depois do passo 4, sair de `enforce` abre Afiliados a quem só tem Saver (chave de Afiliados ausente = ilimitado). Problema pontual se resolve religando o produto do tenant pela rota admin; `log` fica como último recurso, com o vazamento sabido.

## 7. Riscos / pontos frágeis

| Risco | Mitigação |
| --- | --- |
| Alterar `ApplyBillingEventUseCase` (dinheiro) | T1 grava testes de caracterização antes; ramo de Afiliados não muda; tudo na mesma transação |
| Hook `onRoute` anexando `preHandler` em ordem errada | Teste com `inject`: gate enxerga `tenantContext`; rota pública do mesmo plugin não é afetada |
| Tenant legado bloqueado por engano | Sem linha = ativo; modo `log` antes de `enforce`; reversão por env |
| Chave compartilhada rebaixando sessões de tenant legado ilimitado | PROD-18 + teste dedicado |
| Reativação manual de tenant por caminho não mapeado | Nenhum caminho de hoje grava linha; só PROD-14/15 gravam inativo, e só quando o tenant segue ativo por outro produto |
| Painel novo com API antiga (ou o contrário) | `products` aditivo e com padrão legado |
| Cache de 45 s após corte | Aceito; mesmo atraso do gate de chat |
| Assinatura de plano desconhecido desligar Afiliados de cliente atual (revisão) | `legacyGrants` conta plano desconhecido a favor de Afiliados; caso fixado em T10/T11/T12 |
| Preset de produto novo rebaixar sessões de tenant legado ilimitado (revisão) | `excludeKeys: SHARED_KEYS` no sync; só o merge escreve; teste em T11 |
| Tenant bloqueado pelo super admin pagando Afiliados ganhar linha inativa (revisão) | PROD-14 decide pelo snapshot da central, nunca pelo status local |
| Ex-cliente Afiliados que vira só-Saver segue usando a extensão por cookie (revisão) | Checagem por `mlTenantId` dentro do módulo `extension` (T15) |
| Gate empilhado N vezes por array compartilhado (revisão) | Array novo por rota; teste "gate executa uma vez" em T6 |
| Painel presumir Afiliados no reload (revisão) | `tenantsLoaded`; carregamento em vez de padrão legado |

## 8. O que não fazer

- Não fazer backfill em `tenant_products`.
- Não renomear nem reaproveitar `Tenant.planSlug` para outro produto.
- Não colocar o gate dentro de `resolveMembership`.
- Não ligar `enforce` sem a janela em `log`.
- Não escrever preço nem regra de cobrança; o produto vem só do `planSlug` da central.
- Não usar o nome da marca em chave, tipo ou rota (`AFFILIATES`, `SAVER`, não `COPYSYNC_…` em nome novo).
