import { describe, expect, it } from 'vitest';
import { env } from './env';

describe('SAVER_EXTRACTION_WORKER_ENABLED', () => {
  it('desligado por padrão (`.env` aponta para produção)', () => {
    expect(env.SAVER_EXTRACTION_WORKER_ENABLED).toBe(false);
  });
});
