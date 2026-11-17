import type { FastifyInstance, RouteOptions } from 'fastify';
import { env } from '../shared/config/env';
import { tenantHook } from '../shared/http/hooks/tenantHook';
import { sseAuthHook } from '../shared/http/hooks/sseAuthHook';
import { createProductGate, type ProductGate, type ProductGateMode } from '../shared/http/hooks/productGate';
import type { IProductAccessReader } from '../modules/tenants/domain/contracts/IProductAccessReader';
import type { ProductKey } from '../modules/tenants/domain/services/resolveProductAccess';
import { productAccessReader } from '../modules/tenants/infrastructure/productAccessContainer';

/** `TENANT` = rota da conta (auth, sessões, assinatura, admin, públicas): nunca passa pelo gate de produto. */
export type RouteProductClass = ProductKey | 'TENANT';

/**
 * Classe de cada plugin registrado em `routes.ts` (chave = identificador do plugin lá). Fonte única da
 * classificação: `productRoutes.test.ts` falha se um `app.register` de `routes.ts` não estiver aqui ou
 * se a classe não bater com o `withProduct` usado. Plugin novo entra aqui antes de ir para `routes.ts`.
 * `SAVER` já é aceito: as rotas do produto entram com `withProduct('SAVER', …)` quando existirem.
 */
export const ROUTE_PRODUCT_MAP: Readonly<Record<string, RouteProductClass>> = {
  authRoutes: 'TENANT',
  inviteRoutes: 'TENANT',
  tenantRoutes: 'TENANT',
  subscriptionRoutes: 'TENANT',
  meRoutes: 'TENANT',
  sessionRoutes: 'TENANT',
  chatRoutes: 'CHAT',
  chatWsRoutes: 'CHAT',
  affiliateCredentialRoutes: 'AFFILIATES',
  marketplaceRiskAdminRoutes: 'TENANT',
  offerRoutes: 'AFFILIATES',
  offerHuntRoutes: 'AFFILIATES',
  offerHuntAiSuggestRoutes: 'AFFILIATES',
  sendQueueRoutes: 'AFFILIATES',
  broadcastGroupsRoutes: 'AFFILIATES',
  groupMonitoringRoutes: 'AFFILIATES',
  provisioningRoutes: 'TENANT',
  aiAdminRoutes: 'TENANT',
  aiTenantRoutes: 'AFFILIATES',
  linkRotationRoutes: 'AFFILIATES',
  linkDomainAdminRoutes: 'TENANT',
  workerAdminRoutes: 'TENANT',
  opsMetricsRoutes: 'TENANT',
  infraCostsRoutes: 'TENANT',
  planEntitlementAdminRoutes: 'TENANT',
  redirectLinkAdminRoutes: 'TENANT',
  publicRedirectRoutes: 'TENANT',
  storefrontRoutes: 'AFFILIATES',
  offerStoryRoutes: 'AFFILIATES',
  billingRoutes: 'TENANT',
  extensionRoutes: 'AFFILIATES',
  mediaUploadRoutes: 'TENANT',
};

type Handler = NonNullable<RouteOptions['preHandler']>;
type HookFn = Exclude<Handler, readonly unknown[]>;

/**
 * preHandlers que resolvem `tenantContext`: o gate entra logo depois do primeiro deles. `sseAuthHook`
 * cobre a abertura de conexões persistentes (WebSocket do chat, SSE): negada antes do upgrade.
 */
const TENANT_ANCHORS: ReadonlySet<unknown> = new Set<unknown>([tenantHook, sseAuthHook]);

/**
 * Array NOVO com o gate logo após o hook de tenant (antes de portões por rota, como o de audiência do
 * caçador). Nunca muta o original: vários módulos compartilham um único `const preHandler` entre rotas.
 * Sem hook de tenant: devolve o valor original (rota pública do plugin não recebe o gate).
 */
export function insertGateAfterTenantHook(current: RouteOptions['preHandler'], gate: ProductGate): RouteOptions['preHandler'] {
  if (!current) return current;
  const list: HookFn[] = Array.isArray(current) ? [...(current as HookFn[])] : [current as HookFn];
  const at = list.findIndex((fn) => TENANT_ANCHORS.has(fn));
  if (at < 0) return current;
  list.splice(at + 1, 0, gate as unknown as HookFn);
  return list;
}

/** Rota de plugin de produto que ficou sem gate (sem `tenantHook`/`sseAuthHook`). Lista pequena, montada no boot. */
export interface UngatedProductRoute {
  product: ProductKey;
  method: string;
  url: string;
}

const ungated: UngatedProductRoute[] = [];

function recordUngated(product: ProductKey, route: RouteOptions): void {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) ungated.push({ product, method: String(method), url: route.url });
}

/** Rotas de plugin de produto registradas sem gate neste processo (o teste confere contra a lista de exceções). */
export function listUngatedProductRoutes(): readonly UngatedProductRoute[] {
  return ungated;
}

/**
 * Exceções conhecidas de plugin de produto sem hook de tenant (`MÉTODO url` sem o prefixo da API). Rota
 * nova sem âncora quebra `productRoutes.registry.test.ts` até entrar aqui com o motivo.
 * - Extensão por cookie (`extensionAuthHook`, sem `tenantContext`): as de sincronização checam o produto
 *   pelo `mlTenantId` dentro do módulo (`extensionAffiliatesHook`); logout, perfil e heartbeat são da
 *   instalação (design §3.5).
 * - Extensão com Bearer sem tenant (sessões da extensão do usuário) e ciclo de vida (público): sem tenant.
 * - `GET /offer-hunts/access`: só diz se o menu do caçador aparece (nunca 403, sem dado do tenant).
 * `HEAD` automático do Fastify não entra (o teste ignora).
 */
export const UNGATED_PRODUCT_ROUTE_EXCEPTIONS: ReadonlySet<string> = new Set<string>([
  'PUT /extension/marketplaces/ml/session',
  'PUT /extension/marketplaces/shein/session',
  'DELETE /extension/session',
  'GET /extension/me',
  'POST /extension/heartbeat',
  'GET /extension/sessions',
  'DELETE /extension/sessions/:id',
  'POST /extension/lifecycle/event',
  'POST /extension/lifecycle/uninstall',
  'POST /extension/lifecycle/feedback',
  'GET /offer-hunts/access',
]);

export interface ProductRouteDeps {
  reader?: IProductAccessReader;
  mode?: ProductGateMode;
}

type Plugin<O> = (instance: FastifyInstance, opts: O) => Promise<void>;

/**
 * Envolve o plugin de rotas de um produto: no escopo encapsulado, um `onRoute` põe o gate do produto
 * em cada rota que tem hook de tenant (docs/acesso-por-produto.md). Uso: `app.register(withProduct('AFFILIATES', offerRoutes), …)`.
 */
export function withProduct<O>(product: ProductKey, plugin: Plugin<O>, deps: ProductRouteDeps = {}): Plugin<O> {
  return async function productScopedRoutes(instance: FastifyInstance, opts: O): Promise<void> {
    const gate = createProductGate(product, deps.reader ?? productAccessReader(), deps.mode ?? env.PRODUCT_ACCESS_GATE_MODE);
    instance.addHook('onRoute', (route) => {
      const next = insertGateAfterTenantHook(route.preHandler, gate);
      if (next === route.preHandler) recordUngated(product, route);
      route.preHandler = next;
    });
    await plugin(instance, opts);
  };
}
