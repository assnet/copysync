import { describe, it, expect, vi } from 'vitest';
import { ReactionEchoRegistry } from './ReactionEchoRegistry';

function makeRegistry(maxPerSession = 3, ttlMs = 1_000) {
  let now = 0;
  const onForcedEviction = vi.fn();
  const registry = new ReactionEchoRegistry({
    ttlMs,
    maxPerSession,
    now: () => now,
    onForcedEviction,
  });
  return { registry, onForcedEviction, advance: (ms: number) => { now += ms; } };
}

describe('ReactionEchoRegistry', () => {
  it('reconhece o eco de uma reação registrada e retira o id', () => {
    const { registry } = makeRegistry();
    registry.register('s1', 'r1');
    expect(registry.consume('s1', 'r1')).toBe(true);
    // O mesmo id não é eco duas vezes.
    expect(registry.consume('s1', 'r1')).toBe(false);
  });

  it('não reconhece id que nunca foi registrado', () => {
    const { registry } = makeRegistry();
    expect(registry.consume('s1', 'desconhecido')).toBe(false);
  });

  it('isola os ids por sessão', () => {
    const { registry } = makeRegistry();
    registry.register('s1', 'r1');
    expect(registry.consume('s2', 'r1')).toBe(false);
    expect(registry.consume('s1', 'r1')).toBe(true);
  });

  it('esquece o id depois do TTL', () => {
    const { registry, advance } = makeRegistry(3, 1_000);
    registry.register('s1', 'r1');
    advance(1_001);
    expect(registry.consume('s1', 'r1')).toBe(false);
  });

  it('mantém o id quando o envio falha, para reconhecer o eco tardio', () => {
    // Nada na API retira o id além do consumo ou do TTL: o adapter registra, o envio
    // estoura timeout e o eco ainda chega depois.
    const { registry, advance } = makeRegistry();
    registry.register('s1', 'r1');
    advance(500);
    expect(registry.consume('s1', 'r1')).toBe(true);
  });

  it('com o teto cheio, descarta primeiro o id vencido e preserva os que estão no TTL', () => {
    const { registry, advance, onForcedEviction } = makeRegistry(3, 1_000);
    registry.register('s1', 'velho');
    advance(600);
    registry.register('s1', 'a');
    registry.register('s1', 'b');
    advance(500); // 'velho' vence; 'a' e 'b' seguem no TTL
    registry.register('s1', 'c');

    expect(onForcedEviction).not.toHaveBeenCalled();
    expect(registry.consume('s1', 'a')).toBe(true);
    expect(registry.consume('s1', 'b')).toBe(true);
    expect(registry.consume('s1', 'c')).toBe(true);
  });

  it('com o teto cheio e nenhum vencido, tira o mais antigo e avisa', () => {
    const { registry, onForcedEviction } = makeRegistry(2, 1_000);
    registry.register('s1', 'a');
    registry.register('s1', 'b');
    registry.register('s1', 'c');

    expect(onForcedEviction).toHaveBeenCalledWith('s1', 'a');
    expect(registry.consume('s1', 'a')).toBe(false);
    expect(registry.consume('s1', 'b')).toBe(true);
    expect(registry.consume('s1', 'c')).toBe(true);
  });

  it('o teto de uma sessão não afeta outra', () => {
    const { registry, onForcedEviction } = makeRegistry(1, 1_000);
    registry.register('s1', 'a');
    registry.register('s2', 'b');
    expect(onForcedEviction).not.toHaveBeenCalled();
    expect(registry.consume('s1', 'a')).toBe(true);
    expect(registry.consume('s2', 'b')).toBe(true);
  });
});
