import { describe, expect, it, vi } from 'vitest';
import { CapacityLimitedLeaseGate } from './CapacityLimitedLeaseGate';

const setup = (local: string[], max: number, acquire = vi.fn(async () => true)) => {
  const log = { warn: vi.fn() };
  const gate = new CapacityLimitedLeaseGate({ acquire }, () => local, max, log as never);
  return { gate, acquire, log };
};

describe('CapacityLimitedLeaseGate', () => {
  it('cheio nega sessão nova sem chamar o acquire e loga', async () => {
    const { gate, acquire, log } = setup(['a', 'b'], 2);
    expect(await gate.acquire('c')).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith({ sessionId: 'c', active: 2, max: 2 }, expect.any(String));
  });

  it('cheio aceita a sessão já local (repassa)', async () => {
    const { gate, acquire } = setup(['a', 'b'], 2);
    expect(await gate.acquire('a')).toBe(true);
    expect(acquire).toHaveBeenCalledWith('a');
  });

  it('acima do teto também nega sessão nova', async () => {
    const { gate } = setup(['a', 'b', 'c'], 2);
    expect(await gate.acquire('d')).toBe(false);
  });

  it('abaixo do teto chama o acquire e devolve o resultado', async () => {
    const acquire = vi.fn(async () => false);
    const { gate } = setup(['a'], 2, acquire);
    expect(await gate.acquire('b')).toBe(false);
    expect(acquire).toHaveBeenCalledWith('b');
  });

  it('erro do acquire vira false', async () => {
    const acquire = vi.fn(async () => {
      throw new Error('db');
    });
    const { gate, log } = setup([], 2, acquire);
    expect(await gate.acquire('a')).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('CapacityLimitedLeaseGate — reserva síncrona (T22)', () => {
  const deferred = () => {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('5 acquires simultâneos com max=3 e local=2 → só 1 passa', async () => {
    const d = deferred();
    const acquire = vi.fn(() => d.promise);
    const { gate } = setup(['a', 'b'], 3, acquire);
    const all = ['c', 'd', 'e', 'f', 'g'].map((id) => gate.acquire(id));
    d.resolve(true);
    expect(await Promise.all(all)).toEqual([true, false, false, false, false]);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('acquireResult simultâneo também reserva: excedentes viram held', async () => {
    const d = deferred();
    const { gate } = setup(['a', 'b'], 3, vi.fn(() => d.promise));
    const all = [gate.acquireResult('c'), gate.acquireResult('d')];
    d.resolve(true);
    expect(await Promise.all(all)).toEqual(['acquired', 'held']);
  });

  it('sessão já local passa sem reservar (não consome vaga)', async () => {
    const local = ['a', 'b'];
    const { gate } = setup(local, 3);
    expect(await gate.acquire('a')).toBe(true);
    expect(await gate.acquire('c')).toBe(true);
  });

  it('negação ou erro do inner libera a vaga na hora', async () => {
    const acquire = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce(true);
    const { gate } = setup(['a', 'b'], 3, acquire);
    expect(await gate.acquire('c')).toBe(false);
    expect(await gate.acquire('d')).toBe(false);
    expect(await gate.acquire('e')).toBe(true);
  });

  it('sucesso segura a vaga até a sessão aparecer em listLocal, sem contar duas vezes', async () => {
    const local = ['a'];
    const { gate } = setup(local, 3);
    expect(await gate.acquire('b')).toBe(true);
    expect(await gate.acquire('c')).toBe(true);
    expect(await gate.acquire('d')).toBe(false);
    local.push('b', 'c');
    expect(await gate.acquire('d')).toBe(false);
    local.splice(local.indexOf('b'), 1);
    expect(await gate.acquire('d')).toBe(true);
  });

  it('sucesso sem aparecer em listLocal libera após o TTL', async () => {
    vi.useFakeTimers();
    try {
      const log = { warn: vi.fn() };
      const gate = new CapacityLimitedLeaseGate({ acquire: async () => true }, () => [], 1, log as never, 1_000);
      expect(await gate.acquire('a')).toBe(true);
      expect(await gate.acquire('b')).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(await gate.acquire('b')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mesma sessão em voo duas vezes não reserva duas vagas', async () => {
    const d = deferred();
    const { gate } = setup([], 2, vi.fn(() => d.promise));
    const all = [gate.acquire('a'), gate.acquire('a'), gate.acquire('b')];
    d.resolve(true);
    expect(await Promise.all(all)).toEqual([true, true, true]);
  });
});
