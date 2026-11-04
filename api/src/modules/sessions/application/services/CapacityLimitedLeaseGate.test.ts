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
