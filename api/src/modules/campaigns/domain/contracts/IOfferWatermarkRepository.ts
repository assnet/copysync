import type { OfferWatermark } from '../entities/OfferWatermark';
import type {
  OfferWatermarkKind,
  OfferWatermarkPosition,
  OfferWatermarkSize,
} from '../services/offerWatermarkRules';

/**
 * Alteração parcial: campo ausente (`undefined`) não é tocado; `null` em `imageKey`/`text` limpa.
 * Trocar só `kind` preserva logo e texto guardados. Valores já validados pelo use case
 * (`offerWatermarkRules.ts`).
 */
export interface OfferWatermarkPatch {
  kind?: OfferWatermarkKind;
  imageKey?: string | null;
  text?: string | null;
  enabled?: boolean;
  position?: OfferWatermarkPosition;
  size?: OfferWatermarkSize;
  opacity?: number;
}

/** Marca d'água por tenant: toda leitura e escrita filtra `tenantId`. */
export interface IOfferWatermarkRepository {
  findByTenant(tenantId: string): Promise<OfferWatermark | null>;
  /** Upsert pelo tenant: cria com os padrões do schema + patch, ou aplica o patch. Devolve o gravado. */
  save(tenantId: string, patch: OfferWatermarkPatch): Promise<OfferWatermark>;
}
