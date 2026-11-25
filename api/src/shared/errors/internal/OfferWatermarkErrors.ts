import { AppError } from '../AppError';

/** Ajuste da marca d'água fora das regras (`offerWatermarkRules.ts`); `field` = campo recusado. */
export class OfferWatermarkInvalidInputError extends AppError {
  constructor(field: 'kind' | 'text' | 'position' | 'size' | 'opacity' | 'enabled') {
    super('OFFER_WATERMARK_INVALID_INPUT', `Invalid offer watermark ${field}`, 422, { field });
  }
}
