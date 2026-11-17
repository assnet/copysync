import { describe, expect, it } from 'vitest';
import { listProductAccess, resolveProductAccess, type ProductAccessRow, type ProductKey } from './resolveProductAccess';

describe('resolveProductAccess', () => {
  it('produto legado sem linha continua ativo (sem backfill)', () => {
    expect(resolveProductAccess('AFFILIATES', null)).toBe(true);
    expect(resolveProductAccess('CHAT', null)).toBe(true);
  });

  it('produto novo sem linha fica inativo', () => {
    expect(resolveProductAccess('SAVER', null)).toBe(false);
  });

  it('linha presente decide pelo status', () => {
    expect(resolveProductAccess('AFFILIATES', { status: 'INACTIVE' })).toBe(false);
    expect(resolveProductAccess('SAVER', { status: 'ACTIVE' })).toBe(true);
  });

  it('chat acompanha a linha de afiliados', () => {
    const rows = new Map<ProductKey, ProductAccessRow>([['AFFILIATES', { status: 'INACTIVE' }], ['SAVER', { status: 'ACTIVE' }]]);
    expect(listProductAccess(rows)).toEqual(['SAVER']);
    expect(listProductAccess(new Map())).toEqual(['AFFILIATES', 'CHAT']);
  });
});
