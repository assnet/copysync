/**
 * Marca d'água própria das ofertas (contrato em `api/src/modules/campaigns/presentation/schemas/offerWatermark.schema.ts`).
 * `IMAGE` usa o logo, `TEXT` usa o texto: um ou outro; trocar o tipo não apaga o outro dado.
 */
export type WatermarkKind = 'IMAGE' | 'TEXT';
export type WatermarkPosition = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT' | 'CENTER';
export type WatermarkSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface OfferWatermark {
  enabled: boolean;
  kind: WatermarkKind;
  text: string | null;
  position: WatermarkPosition;
  size: WatermarkSize;
  /** 20–100 (%). */
  opacity: number;
  /** URL do logo já normalizado pela API; null = sem logo. */
  imageUrl: string | null;
  /** false = operador: só lê. */
  canEdit: boolean;
  updatedAt: string | null;
}

/** `PUT /offer-watermark` (parcial). `text: null` apaga o texto. */
export interface UpdateOfferWatermarkInput {
  enabled?: boolean;
  kind?: WatermarkKind;
  text?: string | null;
  position?: WatermarkPosition;
  size?: WatermarkSize;
  opacity?: number;
}

/** Ajustes editáveis na tela (o rascunho salvo no `sessionStorage`). Nunca leva o logo. */
export interface WatermarkDraft {
  enabled: boolean;
  kind: WatermarkKind;
  text: string;
  position: WatermarkPosition;
  size: WatermarkSize;
  opacity: number;
}
