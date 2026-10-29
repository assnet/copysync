import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import {
  StorefrontNotFoundError,
  StorefrontOfferLimitError,
  StorefrontOrderInvalidError,
  StorefrontPublishedLimitError,
  StorefrontSlugPremiumError,
} from './StorefrontErrors';

describe('StorefrontErrors', () => {
  it.each([
    [new StorefrontSlugPremiumError('comprar'), 'STOREFRONT_SLUG_PREMIUM', 409],
    [new StorefrontOfferLimitError(200), 'STOREFRONT_OFFER_LIMIT', 409],
    [new StorefrontPublishedLimitError(60), 'STOREFRONT_PUBLISHED_LIMIT', 409],
    [new StorefrontNotFoundError(), 'STOREFRONT_NOT_FOUND', 404],
    [new StorefrontOrderInvalidError(), 'STOREFRONT_ORDER_INVALID', 400],
  ])('%s responde com o código e o HTTP do contrato', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });
});
