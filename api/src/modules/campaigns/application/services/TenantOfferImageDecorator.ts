import type { IOfferImageDecorator } from '../../domain/contracts/IOfferImageDecorator';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { IOfferWatermarkRepository } from '../../domain/contracts/IOfferWatermarkRepository';
import type { IOfferWatermarkMediaStore } from '../../domain/contracts/IOfferWatermarkMediaStore';
import type { IOfferWatermarkCompositor, OfferWatermarkMark } from '../../domain/contracts/IOfferWatermarkCompositor';
import { activeWatermarkSource, type OfferWatermark, type OfferWatermarkSource } from '../../domain/entities/OfferWatermark';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'TenantOfferImageDecorator' });

export interface TenantOfferImageDecoratorDeps {
  entitlements: Pick<IEntitlementReader, 'getBoolean'>;
  watermarks: Pick<IOfferWatermarkRepository, 'findByTenant'>;
  logos: IOfferWatermarkMediaStore;
  compositor: IOfferWatermarkCompositor;
}

type ActiveWatermark = { record: OfferWatermark; source: OfferWatermarkSource };

/**
 * Marca d'água do tenant no envio (spec IMG-08…10/13/14). Plano + registro lidos a cada chamada,
 * sem cache (ajuste vale no envio seguinte). Não lê a audiência: o envio em segundo plano obedece
 * só plano + configuração salva (IMG-13). Qualquer falha devolve a foto intacta e loga (IMG-10).
 */
export class TenantOfferImageDecorator implements IOfferImageDecorator {
  constructor(private readonly deps: TenantOfferImageDecoratorDeps) {}

  async applies(tenantId: string): Promise<boolean> {
    try {
      return (await this.active(tenantId)) !== null;
    } catch (err) {
      log.warn({ tenantId, err: (err as Error)?.name }, 'offer watermark check failed, treating as off');
      return false;
    }
  }

  async decorate(tenantId: string, image: Buffer): Promise<Buffer> {
    try {
      const active = await this.active(tenantId);
      if (!active) return image;
      const mark = await this.loadMark(active.source);
      if (!mark) {
        log.warn({ tenantId, reason: 'logo missing' }, 'offer watermark skipped, sending clean photo');
        return image;
      }
      const { position, size, opacity } = active.record;
      return await this.deps.compositor.compose(image, mark, { position, size, opacity });
    } catch (err) {
      log.warn({ tenantId, err: (err as Error)?.name }, 'offer watermark failed, sending clean photo');
      return image;
    }
  }

  /** Plano com a chave `true`, marca ligada e dado do tipo escolhido presente; senão `null`. */
  private async active(tenantId: string): Promise<ActiveWatermark | null> {
    const plan = await this.deps.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED);
    if (plan !== true) return null;
    const record = await this.deps.watermarks.findByTenant(tenantId);
    if (!record?.enabled) return null;
    const source = activeWatermarkSource(record);
    return source ? { record, source } : null;
  }

  private async loadMark(source: OfferWatermarkSource): Promise<OfferWatermarkMark | null> {
    if (source.kind === 'TEXT') return { kind: 'TEXT', text: source.text };
    const logo = await this.deps.logos.read(source.imageKey);
    return logo ? { kind: 'IMAGE', logo } : null;
  }
}
