import { describe, it, expect } from 'vitest';
import { AppError } from '../AppError';
import { OfferStoryProductIncompleteError, OfferStoryTemplateNotFoundError } from './OfferStoryErrors';

describe('OfferStoryErrors', () => {
  it.each([
    [new OfferStoryTemplateNotFoundError('x'), 'OFFER_STORY_TEMPLATE_NOT_FOUND', 400],
    [new OfferStoryProductIncompleteError(), 'OFFER_STORY_PRODUCT_INCOMPLETE', 422],
  ])('%s responde com o código e o HTTP do contrato', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });
});
