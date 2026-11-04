# Tela "Assinatura" — Spec

**Status**: Draft (2026-11-04) · Trilha B do lançamento (M2, `docs/arquitetura-central-billing.md` "Painel").
Branch de execução: `feature/subscription-page` a partir de `feature/rebranding-app` (memória: branch de integração).

## Objetivo

Mostrar ao tenant o plano atual, o status da assinatura, o vencimento (se houver) e o uso × limite de cada
entitlement, com botão para a página de venda (Cakto via redirect da central). Sem checkout próprio (decisão
2026-11-04: só depois da escala), sem preço no banco, sem chamada à central em request de usuário.

## Estado atual (conferido no código, `889396b`)

| Peça | Onde | Situação |
| --- | --- | --- |
| `Tenant.planSlug`, `status` (ACTIVE/SUSPENDED/CANCELLED), `suspendedAt` | `api/prisma/schema.prisma:135-147` | existe |
| Vencimento | nenhum campo; o hub manda `expiresAt` no evento (`billing.routes.test.ts:20`), `BillingEventPayload` ignora (`ApplyBillingEventUseCase.ts:39-43`) | **falta** |
| `TenantEntitlement` + `IEntitlementReader.getNumber/getBoolean` | `tenants/domain/contracts/IEntitlementReader.ts`, `PrismaEntitlementReader.ts` | existe; sem leitura em lote |
| Uso por recurso | espalhado: `GetSessionLimitsUseCase`, `GroupMonitorConfigUseCases`, `GetLinkRotationOverviewUseCase`, `GetOfferUsageUseCase` (`GET /campaigns/offers/usage`) | sem visão consolidada |
| Endpoint para o painel | `GET /me` devolve tenant com `status`, sem `planSlug` (`me.routes.ts:73`) | **falta** `GET /subscription` |
| Tenant suspenso | `resolveMembership.ts:25,46` lança `TENANT_SUSPENDED` em toda rota com `tenantHook`; o painel não trata o código (`apiClient.ts:170`) | página ficaria inacessível justo para quem precisa pagar |
| Link de compra | `plans-modal/spec.md` decidiu `VITE_BILLING_CHECKOUT_URL` + slug `copysync-{plano}-{periodo}` no redirect da central; `checkout.ts` **não** existe | **falta** |
| Chip de uso do gerador | `features/offers/components/OfferUsageChip.tsx` | reusar a regra de cor |

## Requisitos

| ID | Requisito |
| --- | --- |
| SUB-01 | `GET {API_PREFIX}/subscription` (tenant do header, use case + presenter) devolve `planSlug`, `status`, `suspendedAt`, `expiresAt`, `limits[]` |
| SUB-02 | Rota acessível com tenant `SUSPENDED`/`CANCELLED` (só leitura, só esta rota); membro inexistente continua 403 |
| SUB-03 | Vencimento: `Tenant.subscriptionExpiresAt` gravado pelo receiver em `activated`/`renewed`/`updated`; `null` = sem vencimento conhecido (não mostra) |
| SUB-04 | `limits[]`: um item por entitlement exibido, `{ key, channel, kind: 'count'\|'daily'\|'feature', used, limit, enabled }`; `limit null` = ilimitado; chaves só de `ENTITLEMENT_KEYS` |
| SUB-05 | Uso: sessões por canal, grupos monitorados/de disparo por canal (de sessões existentes), rodízios por canal, ofertas geradas hoje (fuso de `startOfDayInZone`) e pedidos de IA do dia se houver contador |
| SUB-06 | Card do plano: nome/tagline do `PLAN_CATALOG` pelo slug (sem preço), chip de status (ACTIVE `success`, SUSPENDED `warning`, CANCELLED `error`, sem plano `default`), vencimento em data local |
| SUB-07 | Botão "Ver planos e assinar" abre a página de venda em nova aba (`rel="noopener noreferrer"`) via `buildCheckoutUrl`; env ausente → leva a `/affiliates/plans` |
| SUB-08 | Tabela de limites por canal (WhatsApp/Telegram com `AppIcon`), barra de uso com cor da regra do `OfferUsageChip`, Tooltip com o hint de cada limite, booleano como "Incluso"/"A partir do X" |
| SUB-09 | Painel com `TENANT_SUSPENDED` em qualquer chamada redireciona para a tela (exceto nela mesma) e a tela mostra aviso de pendência |
| SUB-10 | Regras do painel: textos em `strings.ts` (i18n), claro/escuro/sistema só com `theme.palette`, Lucide via `AppIcon`, Tooltip, `usePersistedState` (aba de canal, escopo `tab`), flag de privacidade para o nome do tenant |
| SUB-11 | Documentado (`docs/assinatura.md`, link no `AGENTS.md`, CHANGELOG, versões api/app minor) |

## Contrato (fixo para as tasks em paralelo)

```ts
// GET /subscription → 200 { success, data }
interface SubscriptionResponse {
  tenantName: string;
  planSlug: 'starter' | 'profissional' | 'business' | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  suspendedAt: string | null;   // ISO
  expiresAt: string | null;     // ISO
  limits: Array<{
    key: string;                // ENTITLEMENT_KEYS
    channel: 'whatsapp' | 'telegram' | null;
    kind: 'count' | 'daily' | 'feature';
    used: number | null;        // feature = null
    limit: number | null;       // null = ilimitado
    enabled: boolean;           // feature: valor; count/daily: limit !== 0
  }>;
}
```

## Fora de escopo

Checkout próprio, troca de plano no painel, cancelamento pelo painel, preço vindo da central (fase 2 do
`plans-modal`), corpo da reconciliação (H2 da central), histórico de faturas.
