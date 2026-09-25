import { describe, it, expect } from 'vitest';
import { diskBudget } from './diskBudget';

const MIB = 1024 * 1024;

describe('diskBudget', () => {
  it('no disco pequeno de produção reserva 100 MiB e deixa metade do disco para uploads abertos', () => {
    expect(diskBudget({ totalBytes: 974_000_000 })).toEqual({
      reserveBytes: 100 * MIB,
      maxOpenBytes: 487_000_000,
    });
  });

  it('no disco de 10 GB reserva 10% e limita os uploads abertos a 2 GB', () => {
    expect(diskBudget({ totalBytes: 10_000_000_000 })).toEqual({
      reserveBytes: 1_000_000_000,
      maxOpenBytes: 2_000_000_000,
    });
  });

  it('a reserva nunca fica abaixo de 100 MiB, mesmo em disco minúsculo', () => {
    expect(diskBudget({ totalBytes: 50 * MIB }).reserveBytes).toBe(100 * MIB);
  });

  it('devolve bytes inteiros quando o total não divide exato', () => {
    const budget = diskBudget({ totalBytes: 3_000_000_007 });

    expect(Number.isInteger(budget.reserveBytes)).toBe(true);
    expect(Number.isInteger(budget.maxOpenBytes)).toBe(true);
  });

  it('a reserva configurada vence a calculada', () => {
    expect(diskBudget({ totalBytes: 974_000_000, reserveBytes: 50 * MIB })).toEqual({
      reserveBytes: 50 * MIB,
      maxOpenBytes: 487_000_000,
    });
  });

  it('o teto configurado vence o calculado', () => {
    expect(diskBudget({ totalBytes: 10_000_000_000, maxOpenBytes: 5_000_000_000 })).toEqual({
      reserveBytes: 1_000_000_000,
      maxOpenBytes: 5_000_000_000,
    });
  });

  it('reserva configurada como zero é respeitada, não trocada pela calculada', () => {
    expect(diskBudget({ totalBytes: 974_000_000, reserveBytes: 0 }).reserveBytes).toBe(0);
  });
});
