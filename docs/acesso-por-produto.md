# Acesso por produto

Cada tenant pode ter um ou mais **produtos** (Afiliados, Chat, Saver), cada um com plano próprio vindo da central.
O gate de produto decide quais rotas e processos o tenant usa. Plano e tarefas: `.specs/features/product-access/`.
Billing: [`arquitetura-central-billing.md`](arquitetura-central-billing.md). Saver: [`saver.md`](saver.md).

## Produtos

| Chave | Produto | Plano | Origem do plano |
| --- | --- | --- | --- |
| `AFFILIATES` | Afiliados | `COPYSYNC_LITE/PRO/MAX` | `Tenant.planSlug` + `Tenant.subscriptionExpiresAt` (como sempre) |
| `CHAT` | Chat / CRM | não tem | acompanha `AFFILIATES` (`ACCESS_FOLLOWS`); nenhuma linha `CHAT` é gravada |
| `SAVER` | Saver | `SAVER_LITE/PRO/MAX` | linha em `tenant_products` |

Regra pura em `tenants/domain/services/resolveProductAccess.ts`. Nomes em código descrevem o recurso, nunca a marca.

## Regra do legado

- Tabela `tenant_products` (`tenantId`, `product`, `status` ACTIVE|INACTIVE, `planSlug`, `expiresAt`, `source`
  BILLING|ADMIN, `inactiveSince`), única por `(tenantId, product)`. Criada **sem backfill e sem INSERT**.
- **Sem linha**: produto legado (`AFFILIATES`, `CHAT`) = **ativo**; produto novo (`SAVER`) = **inativo**.
- Com linha: ativo só se `status = 'ACTIVE'`.
- Linha `AFFILIATES` inativa só nasce quando o tenant segue ativo por outro produto (cliente novo só-Saver, ou
  Afiliados cortado com Saver pago). Plano desconhecido que dá acesso conta **a favor de Afiliados**.
- Plano de Afiliados nunca dá Saver: Saver exige linha `SAVER` ativa.

## Modo do gate (`PRODUCT_ACCESS_GATE_MODE`)

`off` (padrão) | `log` | `enforce`, em `shared/config/env.ts`. Governa **só os produtos legados**. Produto novo é
exigido em qualquer modo.

| Modo | Rotas de Afiliados/Chat | Segundo plano e páginas públicas |
| --- | --- | --- |
| `off` | não consulta | não consulta |
| `log` | consulta; sem acesso → `warn` `product access would_block`, segue | não consulta |
| `enforce` | sem acesso → 403 `PRODUCT_UNAVAILABLE` (`meta.product`) | filtra (abaixo) |

Tenant só-Saver só pode existir em produção com `enforce`: em `off`/`log` ele usaria Afiliados (chave ausente =
ilimitado). `SetTenantProductUseCase` e o provisionamento de produto novo logam `error` se o modo não for `enforce`.

## Roteiro de implantação

1. Deploy com `off`. Nada muda.
2. `log` na Render por ≥ 48 h. Conferir zero `would_block` em tenants existentes e `SELECT count(*) FROM tenant_products`
   coerente (somente leitura).
3. `enforce`. Sem tenant de produto novo, reverter = voltar a `off` (a tabela pode ficar).
4. Só então o Saver vai a produção: super admin concede a pilotos e os planos Saver entram na central.
5. Depois do passo 4, sair de `enforce` abre Afiliados para quem só tem Saver. Caso pontual: religar o produto pela
   rota admin. `log` só como último recurso, com o vazamento sabido.

## Gate HTTP

- `shared/http/hooks/productGate.ts`: `preHandler` async que **lança** `AppError` (nunca `send` + `return;`).
- `app/productRoutes.ts`: `withProduct(product, plugin)` insere o gate **logo após `tenantHook`**, num array novo por
  rota (nunca `push`: módulos compartilham um `const preHandler`). Antes de portões por rota, como o do caçador: sem
  produto o tenant vê `PRODUCT_UNAVAILABLE`, não `OFFER_HUNTER_UNAVAILABLE`. Rota sem `tenantHook` não recebe gate.
- Classificação em `app/routes.ts`: `AFFILIATES` (ofertas, caçador, fila, grupos de disparo, monitoramento, rodízio,
  vitrine, story, credenciais, extensão, IA do tenant), `CHAT` (chat e WebSocket), `SAVER` (`/saver`). Sem gate: auth,
  tenants, me, users, sessions, subscription, uploads, provisioning, billing, admin e públicas.
- **Super admin passa** (piloto no próprio tenant sem plano). Sem `tenantContext` (rota pública do plugin): passa.
- **Falha de leitura**: produto legado segue em qualquer modo, com log `error` (pico de banco não derruba Afiliados de
  todo tenant); produto novo → 503 genérico `SERVICE_TEMPORARILY_UNAVAILABLE` (nunca libera às cegas).
- Leitor: `CachedProductAccessReader` (cache por processo, TTL 45 s, só cache de leitura). Composição em
  `tenants/infrastructure/productAccessContainer.ts`.

## Segundo plano e páginas públicas

Só `enforce` filtra. `backgroundProductAccessReader()` devolve `AlwaysGranted` fora de `enforce` e, em `enforce`, o
leitor com cache envolto em `FailOpenProductAccessReader` (falha = liberado + `warn`). Produto inativo = linha
`AFFILIATES` com `status <> 'ACTIVE'`.

| Ponto | Com Afiliados inativo |
| --- | --- |
| Rodízio público e vitrine pública | `unavailable` / 503 genérica |
| Claim do envio de ofertas (`PrismaOfferDispatchRepository`) | filtro no mesmo SQL do tenant suspenso (`affiliatesInactiveFilter.ts`): item fica `QUEUED`, sem falha nem laço |
| Sync de membros do rodízio | mesmo `where` exclui o tenant |
| Captura do monitoramento | `ignored` (sessão segue conectada: é do tenant) |
| Chat (ingestão e listeners) | `ProductAwareChatEntitlementGate` em `enforce`, com ou sem `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED`: Chat inativo = chat desligado ([`chat-ingestao-por-entitlement.md`](chat-ingestao-por-entitlement.md)) |
| Caçador, processamento de capturas | sem filtro (envio barrado no claim) |
| Sessões, adoção, `HubOutboxWorker`, retenção da extensão, `/redirect/<slug>` | nada: sessão é do tenant, não do produto |

**Extensão por cookie**: rotas de sync ML e Shein não têm `tenantContext`. `extensionAffiliatesHook`, logo após
`extensionAuthHook`, checa `AFFILIATES` pelo `extensionSession.mlTenantId` → 403 `PRODUCT_UNAVAILABLE`. Logout,
`/me` e heartbeat nunca bloqueiam.

## Billing por produto

- `resolvePlan(planSlug, permissions)` (`tenants/domain/planCatalog.ts`) → `{ product, planSlug }`. Afiliados: igual a
  antes (`resolveEffectivePlanSlug`). Saver: permissão `SAVER_{TIER}` (a mais alta vence), senão slug
  `copysync-saver-{lite|pro|max}-{mensal|anual}` ou interno `SAVER_{TIER}`.
- Evento de Afiliados: caminho de antes, sem mudança de ordem. Evento de produto novo: upsert da linha, preset sem as
  chaves compartilhadas, merge; nunca escreve `Tenant.planSlug`/`subscriptionExpiresAt`.
- Cliente novo só-Saver: `ProvisionTenantUseCase` com `initialProducts` cria o tenant com `planSlug` nulo, linha do
  produto ativa e `AFFILIATES` inativa, na mesma transação.
- Corte e reconciliação: `pickGrantingByProduct` decide por produto. Linha `source=ADMIN` nunca é desativada.

## Concessão manual

`PUT /admin/tenants/:tenantId/products/:product` (só super admin), corpo `{ status, planSlug? }` →
`SetTenantProductUseCase`: grava `source=ADMIN`, aplica o preset (sem compartilhadas), refaz o merge, `AuditLog`
`TENANT_PRODUCT_CHANGED`, invalida o cache. `planSlug` obrigatório ao ligar produto novo e precisa ser do próprio
produto. `CHAT` não é aceito. Serve para pilotos do Saver antes de os planos existirem na central.

## Chaves compartilhadas

`whatsapp_sessions` e `telegram_sessions` (`SHARED_KEYS`, `tenants/domain/sharedEntitlements.ts`) são do tenant. Só
`writeMergedSharedEntitlements` (`tenants/infrastructure/productEntitlements.ts`) as grava: união dos presets dos
produtos com acesso (maior vence; `null` = ilimitado vence tudo). O plano de Afiliados no merge vem **sempre de
`Tenant.planSlug`** (a linha `AFFILIATES` só guarda status). Afiliados ativo sem plano (legado ilimitado) = não grava
nada. Usado por admin, propagação de preset, webhook e reconciliação.

## Admin de presets por produto

`/admin/plan-entitlements` lista os planos de todos os produtos (`ALL_PLAN_SLUGS`). Cada chave tem `product` e
`editablePlans`: só é editável nos planos do produto dono (Shein e Caçador = Afiliados). `PUT
/admin/plan-entitlements/:planSlug/:key` com plano de outro produto → 400; a tela mostra "—" sem controle. A propagação
de preset de produto novo vai por `tenant_products.planSlug` (linha ativa), pula `SHARED_KEYS` e roda o merge.

## Leitura e painel

- `GET /tenants` (e `GET /me`): `tenants[].products: ProductKey[]` (aditivo).
- `GET /subscription`: `products[]` (`product`, `planSlug`, `tier`, `expiresAt`, `source`) e `limits[].product`; os
  campos antigos seguem descrevendo Afiliados ([`assinatura.md`](assinatura.md)).
- Painel `app/src/features/products/`: `useProductAccess`, `ProductRoute` (sem acesso → vitrine do produto),
  `resolveHomePath`, `PRODUCT_HOME`, `PRODUCT_PLANS_PATH`. Enquanto `tenantsLoaded` é falso, mostra carregamento.
  Tenant carregado sem `products` (API antiga) = `['AFFILIATES','CHAT']`.
- `apiClient.ts`: 403 `PRODUCT_UNAVAILABLE` → vitrine do produto. Menu: produto sem acesso aparece com cadeado e só o
  item Planos ([`navegacao-produtos.md`](navegacao-produtos.md)).

## O que não fazer

- Backfill em `tenant_products`, ou gravar linha `CHAT`.
- Renomear ou reaproveitar `Tenant.planSlug` para outro produto.
- Gate dentro de `resolveMembership` ou `push` no `preHandler` compartilhado.
- Ligar `enforce` sem a janela em `log`; vender produto novo fora de `enforce`.
- Gravar `whatsapp_sessions`/`telegram_sessions` fora do merge, ou ler o plano de Afiliados da linha `AFFILIATES`.
- Liberar produto novo quando a leitura falha; bloquear legado quando a leitura falha.
- Preço ou regra de cobrança aqui: o produto vem só do `planSlug`/`permissions` da central.
- Marca em chave, tipo ou rota (`AFFILIATES`, `SAVER`, nunca `COPYSYNC_…` em nome novo).
