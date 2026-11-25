/** Logo já validado e normalizado: PNG com canal alfa, lado maior ≤ 512 px. */
export interface NormalizedOfferWatermarkLogo {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Valida o logo enviado pelo CONTEÚDO (nunca pelo mime declarado) e normaliza para PNG
 * (limites em `offerWatermarkRules.ts`). Erros de mídia: `MEDIA_TOO_LARGE` (> 1 MiB),
 * `UNSUPPORTED_MEDIA_TYPE` (não é PNG/WebP com transparência), `MEDIA_PROCESSING_FAILED`
 * (menor que 100×100 ou ilegível).
 */
export interface IOfferWatermarkLogoProcessor {
  normalize(input: Buffer): Promise<NormalizedOfferWatermarkLogo>;
}
