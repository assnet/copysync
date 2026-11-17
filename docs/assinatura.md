# Assinatura (Configurações > Assinatura)

Tela `/settings/subscription` (app 0.77.0 · api 0.60.0). Mostra ao tenant plano, status, vencimento e uso × limite
de cada entitlement, com botão para a página de venda. Spec: `.specs/features/subscription-page/`.
Billing em si (hub, webhook, entitlements): [`arquitetura-central-billing.md`](arquitetura-central-billing.md).

## Contrato `GET {API_PREFIX}/subscription`

Hooks `[authHook, tenantAnyStatusHook]`; tenant do header `X-Tenant-Id`. `200 { success, data }`:

```ts
{
  tenantName: string;
  planSlug: 'lite' | 'pro' | 'max' | null; // slug da vitrine
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  suspendedAt: string | null;  // ISO
  expiresAt: string | null;    // ISO; null = vencimento desconhecido (não mostra)
  limits: Array<{ key; channel: 'whatsapp' | 'telegram' | null; kind: 'count' | 'daily' | 'feature';
                  used: number | null; limit: number | null /* null = ilimitado */; enabled: boolean }>;
}
```

| Peça | Onde | Regra |
| --- | --- | --- |
| Slug | `SubscriptionPresenter.ts` | `COPYSYNC_LITE/PRO/MAX` → `lite/pro/max` (api 0.68.0; antes `starter/profissional/business`); fora de `PLAN_SLUGS` → `null` |
| Limites | `tenants/domain/services/subscriptionLimits.ts` | um item por chave de `ENTITLEMENT_KEYS`; numérico ausente = ilimitado; feature ausente = `false` (exceto `mention_all_enabled`/`ai_rewrite_enabled`: só `false` explícito bloqueia). Chave nova sem linha → teste falha |
| Uso | `PrismaTenantUsageReader.ts` | contagem gravada (D5), `tenantId` em toda consulta: sessões por engine, grupos monitorados/de disparo de sessões existentes, rodízios, ofertas desde `startOfDayInZone`, `AiUsageLog` do dia |
| Entitlements | `IEntitlementSnapshotReader.readAll` | 1 `findMany` |
| Vencimento | `Tenant.subscriptionExpiresAt` | gravado pelo receiver em `activated`/`renewed`/`updated`; demais eventos preservam. Tenants antigos ficam `null` até o próximo evento |
| Use case | `GetTenantSubscriptionUseCase.ts` | tenant inexistente → 404 |
| Produtos | `SubscriptionPresenter.ts` | `products[]` (`product`, `planSlug`, `tier`, `expiresAt`, `source`) e `limits[].product`, aditivos; os campos de cima seguem descrevendo Afiliados ([`acesso-por-produto.md`](acesso-por-produto.md)) |

## Tenant suspenso

- `tenantAnyStatusHook` aceita SUSPENDED/CANCELLED (não-membro segue 403). **Só** nesta rota.
- Painel: `TENANT_SUSPENDED` em qualquer chamada → `apiClient.ts` redireciona uma vez para
  `/settings/subscription?suspended=1` (nunca a partir da própria tela, sem limpar a sessão). A tela mostra o aviso.

## Painel

`pages/settings/SubscriptionPage.tsx`, `features/subscription/` (`strings.ts`, `SubscriptionPlanCard`,
`SubscriptionLimitsTable`, `usageTone.ts`). Nome/tagline do `PLAN_CATALOG` (sem preço); chip de status;
barra de uso com `usageTone` (≥80% `warning`, 100% `error`); aba de canal em `usePersistedState` (escopo `tab`);
flag `subscription.tenantName`. CTA só para ADMIN (OPERATOR vê "fale com o administrador"): o botão leva
à vitrine do produto (Afiliados: `/affiliates/plans`), onde plano e período são escolhidos. Nunca abre o pagamento do plano atual
direto: quem quer trocar de plano ou assina o anual pagaria a oferta errada. Sem env (`VITE_BILLING_CHECKOUT_URL` removida no app 0.86.0).
Ofertas: [`plano-lancamento-hub-copysync.md`](plano-lancamento-hub-copysync.md#ofertas-do-copysync-na-cakto).

**Por produto**: um cartão de plano + tabela de limites para cada produto com acesso (`features/subscription/productLimits.ts`
agrupa por `limits[].product`; sessões só no primeiro cartão; chaves `saver_*` no cartão do Saver). CTA leva à vitrine do
próprio produto (`PRODUCT_PLANS_PATH`); produto sem vitrine fica sem botão. Tenant legado vê a mesma tela de antes.

## O que não fazer

- Reusar `tenantAnyStatusHook` em outra rota (abre dado de tenant suspenso).
- Preço no banco ou na resposta: preço é texto em `features/plans/catalog.ts`.
- Checkout próprio, troca/cancelamento de plano pelo painel (só depois da escala, via central).
- Chamar a central em request de usuário: tudo vem do banco local alimentado pelo receiver.
- Contar uso "ao vivo" pela engine; nem `clearSession` no redirect de suspenso.
