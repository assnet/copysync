import { describe, expect, it } from 'vitest';
import { estimateMercadoLivreCommissionPct, MERCADO_LIVRE_COMMISSION_TABLE_READ_AT } from './mercadoLivreCommissionTable';

describe('estimateMercadoLivreCommissionPct', () => {
  it.each([
    ['MLB1246', 16],
    ['MLB1430', 16],
    ['MLB1276', 16],
    ['MLB1574', 12],
    ['MLB1384', 12],
    ['MLB1132', 12],
    ['MLB263532', 12],
    ['MLB1000', 5],
    ['MLB1051', 5],
    ['MLB1648', 5],
    ['MLB1403', 0],
  ])('%s → %i%%', (id, pct) => {
    expect(estimateMercadoLivreCommissionPct(id)).toBe(pct);
  });

  it('normaliza caixa e espaços', () => {
    expect(estimateMercadoLivreCommissionPct(' mlb1051 ')).toBe(5);
  });

  it('categoria fora da tabela, vazia ou null → null', () => {
    expect(estimateMercadoLivreCommissionPct('MLB5726')).toBeNull();
    expect(estimateMercadoLivreCommissionPct('')).toBeNull();
    expect(estimateMercadoLivreCommissionPct(null)).toBeNull();
    expect(estimateMercadoLivreCommissionPct(undefined)).toBeNull();
  });

  it('registra a data da leitura', () => {
    expect(MERCADO_LIVRE_COMMISSION_TABLE_READ_AT).toBe('2026-11-06');
  });
});
