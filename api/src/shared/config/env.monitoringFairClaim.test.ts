import { describe, expect, it } from 'vitest';
import { env } from './env';

describe('MONITORING_FAIR_CLAIM_ENABLED', () => {
  it('padrão false: FIFO global de hoje (entrega C só liga após migration, com todos no mesmo modo)', () => {
    expect(env.MONITORING_FAIR_CLAIM_ENABLED).toBe(false);
  });
});
