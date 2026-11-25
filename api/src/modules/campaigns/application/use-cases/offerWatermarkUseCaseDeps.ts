import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IUploadSessionStore } from '../../../media/domain/contracts/IUploadSessionStore';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { IOfferWatermarkRepository } from '../../domain/contracts/IOfferWatermarkRepository';
import type { IOfferWatermarkMediaStore } from '../../domain/contracts/IOfferWatermarkMediaStore';
import type { IOfferWatermarkLogoProcessor } from '../../domain/contracts/IOfferWatermarkLogoProcessor';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';
import {
  OFFER_WATERMARK_DEFAULTS,
  canEditOfferWatermark,
  type OfferWatermarkKind,
  type OfferWatermarkPosition,
  type OfferWatermarkSize,
} from '../../domain/services/offerWatermarkRules';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';

/** Upload em partes: só o ciclo de consumo (o painel sobe por `chunkedUpload`). */
export type OfferWatermarkUploadStore = Pick<IUploadSessionStore, 'beginConsume' | 'releaseConsume' | 'discard' | 'binPath'>;

export interface OfferWatermarkUseCaseDeps {
  watermarks: IOfferWatermarkRepository;
  entitlements: Pick<IEntitlementReader, 'getBoolean'>;
  logos: IOfferWatermarkMediaStore;
  processor: IOfferWatermarkLogoProcessor;
  uploads: OfferWatermarkUploadStore;
  /** Lê o `.bin` do upload (fs na infra; a aplicação não toca disco). */
  readFile: (path: string) => Promise<Buffer>;
}

/** Quem pede (do `tenantContext`): papel decide se grava. */
export interface OfferWatermarkActor {
  tenantId: string;
  userId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';
  isSuperAdmin: boolean;
}

/** Saída dos use cases: nunca a chave do storage, só a URL do logo. */
export interface OfferWatermarkView {
  enabled: boolean;
  kind: OfferWatermarkKind;
  text: string | null;
  position: OfferWatermarkPosition;
  size: OfferWatermarkSize;
  opacity: number;
  imageUrl: string | null;
  /** Papel do usuário logado: admin do tenant ou super admin. */
  canEdit: boolean;
  updatedAt: Date | null;
}

export const OFFER_WATERMARK_KEY = ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED;

/** Gate do plano: só `offer_watermark_enabled === true` libera (ausente/false bloqueiam). */
export async function requireOfferWatermarkPlan(entitlements: OfferWatermarkUseCaseDeps['entitlements'], tenantId: string): Promise<void> {
  if ((await entitlements.getBoolean(tenantId, OFFER_WATERMARK_KEY)) !== true) {
    throw new PlanFeatureUnavailableError(OFFER_WATERMARK_KEY);
  }
}

/** Gravação: admin do tenant ou super admin; operador recebe 403 `FORBIDDEN`. */
export function requireOfferWatermarkEditor(actor: OfferWatermarkActor): void {
  if (!canEditOfferWatermark(actor.role, actor.isSuperAdmin)) throw new ForbiddenError('Only tenant admins can change the offer watermark');
}

/** Registro (ou padrões do schema, sem registro) → visão sem a chave. */
export function toOfferWatermarkView(
  mark: OfferWatermark | null,
  logos: Pick<IOfferWatermarkMediaStore, 'publicUrl'>,
  actor: OfferWatermarkActor,
): OfferWatermarkView {
  return {
    enabled: mark?.enabled ?? OFFER_WATERMARK_DEFAULTS.enabled,
    kind: mark?.kind ?? OFFER_WATERMARK_DEFAULTS.kind,
    text: mark?.text ?? null,
    position: mark?.position ?? OFFER_WATERMARK_DEFAULTS.position,
    size: mark?.size ?? OFFER_WATERMARK_DEFAULTS.size,
    opacity: mark?.opacity ?? OFFER_WATERMARK_DEFAULTS.opacity,
    imageUrl: mark?.imageKey ? logos.publicUrl(mark.imageKey) : null,
    canEdit: canEditOfferWatermark(actor.role, actor.isSuperAdmin),
    updatedAt: mark?.updatedAt ?? null,
  };
}
