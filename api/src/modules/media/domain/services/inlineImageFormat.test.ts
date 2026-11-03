import { describe, it, expect } from 'vitest';
import { needsInlineImageTranscode } from './inlineImageFormat';

describe('needsInlineImageTranscode', () => {
  it('WebP vira JPEG (Android não exibe foto WebP)', () => {
    expect(needsInlineImageTranscode('image/webp')).toBe(true);
    expect(needsInlineImageTranscode('IMAGE/WEBP')).toBe(true);
  });

  it('JPEG e PNG seguem como estão', () => {
    expect(needsInlineImageTranscode('image/jpeg')).toBe(false);
    expect(needsInlineImageTranscode('image/png')).toBe(false);
  });
});
