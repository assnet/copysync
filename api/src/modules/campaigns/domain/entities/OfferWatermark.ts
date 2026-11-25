import type {
  OfferWatermarkKind,
  OfferWatermarkPosition,
  OfferWatermarkSize,
} from '../services/offerWatermarkRules';

/**
 * Marca d'água própria do tenant (1 por tenant; spec IMG-06/07/14). Logo e texto ficam guardados
 * juntos; `kind` decide qual dos dois é aplicado, nunca os dois.
 */
export interface OfferWatermark {
  id: string;
  tenantId: string;
  kind: OfferWatermarkKind;
  /** Chave do logo normalizado no storage; null = sem logo. Nunca sai na resposta HTTP. */
  imageKey: string | null;
  /** Nome da marca (1–32 caracteres, uma linha); null = sem texto. */
  text: string | null;
  enabled: boolean;
  position: OfferWatermarkPosition;
  size: OfferWatermarkSize;
  /** 20–100 (%). */
  opacity: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Fonte da marca que vale para o tipo escolhido; null = o tipo escolhido não tem dado guardado. */
export type OfferWatermarkSource = { kind: 'IMAGE'; imageKey: string } | { kind: 'TEXT'; text: string };

export function activeWatermarkSource(mark: Pick<OfferWatermark, 'kind' | 'imageKey' | 'text'>): OfferWatermarkSource | null {
  if (mark.kind === 'IMAGE') return mark.imageKey ? { kind: 'IMAGE', imageKey: mark.imageKey } : null;
  return mark.text ? { kind: 'TEXT', text: mark.text } : null;
}

/** Troca o tipo sem apagar o outro dado (logo e texto seguem guardados). */
export function changeWatermarkKind<T extends Pick<OfferWatermark, 'kind'>>(mark: T, kind: OfferWatermarkKind): T {
  return { ...mark, kind };
}
