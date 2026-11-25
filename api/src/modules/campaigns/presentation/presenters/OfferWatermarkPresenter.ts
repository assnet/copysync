import type { OfferWatermarkView } from '../../application/use-cases/offerWatermarkUseCaseDeps';

/** Saída HTTP da marca d'água: campos fechados, data em ISO, logo só como URL (nunca a chave do storage). */
export const OfferWatermarkPresenter = {
  watermark(v: OfferWatermarkView) {
    return {
      enabled: v.enabled,
      kind: v.kind,
      text: v.text,
      position: v.position,
      size: v.size,
      opacity: v.opacity,
      imageUrl: v.imageUrl,
      canEdit: v.canEdit,
      updatedAt: v.updatedAt ? v.updatedAt.toISOString() : null,
    };
  },
};
