import { describe, it, expect, vi } from 'vitest';
import { OutboundEchoRegistry } from './OutboundEchoRegistry';
import { ReactionEchoRegistry } from './ReactionEchoRegistry';

function criarRegistro(maxPerSession = 3, ttlMs = 1_000) {
  let agora = 0;
  const onForcedEviction = vi.fn();
  const registro = new OutboundEchoRegistry({
    ttlMs,
    maxPerSession,
    now: () => agora,
    onForcedEviction,
  });
  return { registro, onForcedEviction, avancar: (ms: number) => { agora += ms; } };
}

describe('OutboundEchoRegistry', () => {
  it('reconhece o eco de um id registrado uma única vez', () => {
    const { registro } = criarRegistro();
    registro.register('s1', 'm1');
    expect(registro.consume('s1', 'm1')).toBe(true);
    expect(registro.consume('s1', 'm1')).toBe(false);
  });

  it('não reconhece id nunca registrado nem id de outra sessão', () => {
    const { registro } = criarRegistro();
    registro.register('s1', 'm1');
    expect(registro.consume('s1', 'outro')).toBe(false);
    expect(registro.consume('s2', 'm1')).toBe(false);
  });

  it('esquece o id depois do TTL', () => {
    const { registro, avancar } = criarRegistro(3, 1_000);
    registro.register('s1', 'm1');
    avancar(1_000);
    expect(registro.consume('s1', 'm1')).toBe(true);
    registro.register('s1', 'm2');
    avancar(1_001);
    expect(registro.consume('s1', 'm2')).toBe(false);
  });

  it('registrar de novo o mesmo id renova o TTL e não conta em dobro no teto', () => {
    const { registro, avancar, onForcedEviction } = criarRegistro(2, 1_000);
    registro.register('s1', 'm1');
    avancar(800);
    registro.register('s1', 'm1');
    registro.register('s1', 'm2');
    avancar(800);

    expect(onForcedEviction).not.toHaveBeenCalled();
    expect(registro.consume('s1', 'm1')).toBe(true);
  });

  it('teto cheio: sai primeiro o vencido; sem vencido, o mais antigo, com aviso', () => {
    const { registro, avancar, onForcedEviction } = criarRegistro(2, 1_000);
    registro.register('s1', 'velho');
    avancar(1_001);
    registro.register('s1', 'a');
    registro.register('s1', 'b');
    expect(onForcedEviction).not.toHaveBeenCalled();

    registro.register('s1', 'c');
    expect(onForcedEviction).toHaveBeenCalledWith('s1', 'a');
    expect(registro.consume('s1', 'a')).toBe(false);
    expect(registro.consume('s1', 'b')).toBe(true);
    expect(registro.consume('s1', 'c')).toBe(true);
  });

  it('o nome antigo aponta para a mesma classe', () => {
    expect(ReactionEchoRegistry).toBe(OutboundEchoRegistry);
  });
});
