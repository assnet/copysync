import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Módulo recarregado a cada teste: o registro é único por processo e guarda o relógio da
// criação — cada caso precisa do seu, criado depois do relógio falso.
async function carregar() {
  const { env } = await import('../../../../../shared/config/env');
  const { outboundEchoRegistries } = await import('./outboundEchoRegistries');
  return { env, outboundEchoRegistries };
}

describe('outboundEchoRegistries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve as mesmas instâncias em chamadas diferentes (dois adapters, um registro)', async () => {
    const { outboundEchoRegistries } = await carregar();
    const primeira = outboundEchoRegistries();
    const segunda = outboundEchoRegistries();

    expect(segunda.reactions).toBe(primeira.reactions);
    expect(segunda.media).toBe(primeira.media);
    expect(primeira.media).not.toBe(primeira.reactions);

    // O que uma instância do adapter registra, a outra reconhece.
    primeira.reactions.register('s1', 'r1');
    expect(segunda.reactions.consume('s1', 'r1')).toBe(true);
  });

  it('mídia usa o TTL próprio, mais longo que o de reação', async () => {
    const { env, outboundEchoRegistries } = await carregar();
    const { reactions, media } = outboundEchoRegistries();
    expect(env.MEDIA_ECHO_TTL_MS).toBeGreaterThan(env.REACTION_ECHO_TTL_MS);

    reactions.register('s1', 'r1');
    media.register('s1', 'm1');
    media.register('s1', 'm2');
    vi.advanceTimersByTime(env.REACTION_ECHO_TTL_MS + 1);

    expect(reactions.consume('s1', 'r1')).toBe(false);
    expect(media.consume('s1', 'm1')).toBe(true);

    vi.advanceTimersByTime(env.MEDIA_ECHO_TTL_MS);
    expect(media.consume('s1', 'm2')).toBe(false);
  });

  it('mídia usa o teto próprio por sessão', async () => {
    const { env, outboundEchoRegistries } = await carregar();
    const { media } = outboundEchoRegistries();

    for (let i = 0; i <= env.MEDIA_ECHO_MAX_PER_SESSION; i += 1) media.register('s1', `m${i}`);

    // Um além do teto: só o mais antigo saiu.
    expect(media.consume('s1', 'm0')).toBe(false);
    expect(media.consume('s1', 'm1')).toBe(true);
    expect(media.consume('s1', `m${env.MEDIA_ECHO_MAX_PER_SESSION}`)).toBe(true);
  });
});
