import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import type { IProductAccessReader } from '../../domain/contracts/IProductAccessReader';
import type { ITenantProductRepository, TenantProductSource } from '../../domain/contracts/ITenantProductRepository';
import { isKnownPlanSlug, productOfPlanSlug } from '../../domain/planCatalog';
import {
  accessSourceOf,
  isLegacyProduct,
  isProductKey,
  type ProductKey,
  type TenantProductStatus,
} from '../../domain/services/resolveProductAccess';

export interface SetTenantProductCommand {
  tenantId: string;
  product: string;
  status: TenantProductStatus;
  /** Obrigatório ao ligar produto novo; quando vier, precisa ser plano do próprio produto. */
  planSlug?: string | null;
  /** Super admin (AuditLog). */
  actorUserId: string;
}

export interface SetTenantProductResult {
  tenantId: string;
  product: ProductKey;
  status: TenantProductStatus;
  planSlug: string | null;
  source: TenantProductSource;
}

/** Escritas presas à mesma transação: linha, preset, merge das compartilhadas e auditoria num só commit. */
export interface TenantProductTransactionScope {
  tenantExists(tenantId: string): Promise<boolean>;
  products: Pick<ITenantProductRepository, 'find' | 'upsert'>;
  /** Preset do plano em `tenant_entitlements`, sem as chaves compartilhadas. */
  applyPlanPreset(tenantId: string, planSlug: string): Promise<void>;
  /** União das chaves compartilhadas entre os produtos com acesso (único escritor delas aqui). */
  mergeSharedEntitlements(tenantId: string): Promise<void>;
  audit: IAuditLogRepository;
}

export type TenantProductTransaction = <T>(fn: (scope: TenantProductTransactionScope) => Promise<T>) => Promise<T>;

export interface SetTenantProductDeps {
  transaction: TenantProductTransaction;
  reader: Pick<IProductAccessReader, 'invalidate'>;
  /** Modo do gate de produto (`PRODUCT_ACCESS_GATE_MODE`), lido a cada uso. */
  gateMode: () => 'off' | 'log' | 'enforce';
  /** Aviso operacional (logger `error`). */
  warn: (meta: Record<string, unknown>, msg: string) => void;
}

/**
 * Super admin liga/desliga um produto do tenant (docs/acesso-por-produto.md): grava a linha com
 * `source=ADMIN` (a reconciliação nunca a desativa), aplica o preset do plano, refaz o merge das chaves
 * compartilhadas e audita (`TENANT_PRODUCT_CHANGED`), tudo na mesma transação; depois invalida o cache.
 * `CHAT` não é aceito: acompanha `AFFILIATES`.
 */
export class SetTenantProductUseCase {
  constructor(private readonly deps: SetTenantProductDeps) {}

  async execute(cmd: SetTenantProductCommand): Promise<SetTenantProductResult> {
    const product = this.validate(cmd);
    const result = await this.deps.transaction(async (scope) => {
      if (!(await scope.tenantExists(cmd.tenantId))) throw new NotFoundError('Tenant', cmd.tenantId);
      const previous = await scope.products.find(cmd.tenantId, product);
      const planSlug = cmd.planSlug ?? previous?.planSlug ?? null;
      const row = await scope.products.upsert({
        tenantId: cmd.tenantId,
        product,
        status: cmd.status,
        planSlug,
        expiresAt: null,
        source: 'ADMIN',
      });
      if (cmd.status === 'ACTIVE' && planSlug) await scope.applyPlanPreset(cmd.tenantId, planSlug);
      await scope.mergeSharedEntitlements(cmd.tenantId);
      await scope.audit.create({
        tenantId: cmd.tenantId,
        userId: cmd.actorUserId,
        action: 'TENANT_PRODUCT_CHANGED',
        meta: {
          product,
          status: row.status,
          planSlug: row.planSlug,
          previousStatus: previous?.status ?? null,
          previousPlanSlug: previous?.planSlug ?? null,
          source: row.source,
        },
      });
      return { tenantId: row.tenantId, product: row.product, status: row.status, planSlug: row.planSlug, source: row.source };
    });
    this.deps.reader.invalidate(cmd.tenantId);
    this.warnIfGateNotEnforced(result);
    return result;
  }

  private validate(cmd: SetTenantProductCommand): ProductKey {
    if (!isProductKey(cmd.product)) throw new ValidationError('Unknown product', { product: cmd.product });
    const product = cmd.product;
    if (accessSourceOf(product) !== product) throw new ValidationError('Product follows another product', { product, follows: accessSourceOf(product) });
    if (cmd.status !== 'ACTIVE' && cmd.status !== 'INACTIVE') throw new ValidationError('Invalid status', { status: cmd.status });
    if (cmd.planSlug != null) {
      if (!isKnownPlanSlug(cmd.planSlug) || productOfPlanSlug(cmd.planSlug) !== product) {
        throw new ValidationError('Plan does not belong to product', { product, planSlug: cmd.planSlug });
      }
    } else if (cmd.status === 'ACTIVE' && !isLegacyProduct(product)) {
      throw new ValidationError('Plan is required to enable this product', { product });
    }
    return product;
  }

  /** Fora de `enforce` o corte de produto legado não vale e o tenant só de produto novo segue vendo o legado. */
  private warnIfGateNotEnforced(r: SetTenantProductResult): void {
    const mode = this.deps.gateMode();
    if (mode === 'enforce') return;
    const risky = (r.status === 'ACTIVE' && !isLegacyProduct(r.product)) || (r.status === 'INACTIVE' && isLegacyProduct(r.product));
    if (risky) this.deps.warn({ tenantId: r.tenantId, product: r.product, status: r.status, gateMode: mode }, 'tenant product changed while product gate is not enforced');
  }
}
