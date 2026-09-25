import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SentMessageCache } from './sentMediaCache';

interface MensagemFalsa {
  legenda: string;
}

function criarCache(maxPerSession = 3, ttlMs = 1_000) {
  let agora = 0;
  const cache = new SentMessageCache<MensagemFalsa>({ ttlMs, maxPerSession, now: () => agora });
  return { cache, avancar: (ms: number) => { agora += ms; } };
}

describe('SentMessageCache', () => {
  it('devolve a mensagem guardada quantas vezes o reenvio for pedido', () => {
    const { cache } = criarCache();
    const mensagem = { legenda: 'foto' };
    cache.set('s1', 'm1', mensagem);

    expect(cache.get('s1', 'm1')).toBe(mensagem);
    expect(cache.get('s1', 'm1')).toBe(mensagem);
  });

  it('devolve undefined para id desconhecido', () => {
    const { cache } = criarCache();
    cache.set('s1', 'm1', { legenda: 'foto' });

    expect(cache.get('s1', 'outro')).toBeUndefined();
    expect(cache.get('s9', 'm1')).toBeUndefined();
  });

  it('não entrega a mensagem de uma sessão para outra com o mesmo id', () => {
    const { cache } = criarCache();
    cache.set('s1', 'm1', { legenda: 'da sessão 1' });
    cache.set('s2', 'm1', { legenda: 'da sessão 2' });

    expect(cache.get('s1', 'm1')).toEqual({ legenda: 'da sessão 1' });
    expect(cache.get('s2', 'm1')).toEqual({ legenda: 'da sessão 2' });
  });

  it('esquece a mensagem depois do TTL', () => {
    const { cache, avancar } = criarCache(3, 1_000);
    cache.set('s1', 'm1', { legenda: 'foto' });

    avancar(1_000);
    expect(cache.get('s1', 'm1')).toEqual({ legenda: 'foto' });
    avancar(1);
    expect(cache.get('s1', 'm1')).toBeUndefined();
  });

  it('guardar de novo o mesmo id renova o TTL e troca o conteúdo', () => {
    const { cache, avancar } = criarCache(3, 1_000);
    cache.set('s1', 'm1', { legenda: 'antiga' });
    avancar(800);
    cache.set('s1', 'm1', { legenda: 'nova' });
    avancar(800);

    expect(cache.get('s1', 'm1')).toEqual({ legenda: 'nova' });
  });

  it('com o teto cheio descarta a mais antiga', () => {
    const { cache } = criarCache(3);
    cache.set('s1', 'm1', { legenda: '1' });
    cache.set('s1', 'm2', { legenda: '2' });
    cache.set('s1', 'm3', { legenda: '3' });
    cache.set('s1', 'm4', { legenda: '4' });

    expect(cache.get('s1', 'm1')).toBeUndefined();
    expect(cache.get('s1', 'm2')).toEqual({ legenda: '2' });
    expect(cache.get('s1', 'm4')).toEqual({ legenda: '4' });
  });

  it('o teto é por sessão: uma sessão cheia não descarta a de outra', () => {
    const { cache } = criarCache(2);
    cache.set('s2', 'x1', { legenda: 'outra sessão' });
    cache.set('s1', 'm1', { legenda: '1' });
    cache.set('s1', 'm2', { legenda: '2' });
    cache.set('s1', 'm3', { legenda: '3' });

    expect(cache.get('s2', 'x1')).toEqual({ legenda: 'outra sessão' });
  });
});

// Módulo recarregado a cada teste: o cache é único por processo e guarda o relógio da criação.
async function carregar() {
  const { env } = await import('../../../../../shared/config/env');
  const { sentMediaCache } = await import('./sentMediaCache');
  return { env, sentMediaCache };
}

describe('sentMediaCache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('é a mesma instância para os dois adapters do processo', async () => {
    const { sentMediaCache } = await carregar();
    sentMediaCache().set('s1', 'm1', { conversation: 'x' });

    expect(sentMediaCache()).toBe(sentMediaCache());
    expect(sentMediaCache().get('s1', 'm1')).toEqual({ conversation: 'x' });
  });

  it('usa o TTL e o teto do eco de mídia', async () => {
    const { env, sentMediaCache } = await carregar();
    const cache = sentMediaCache();
    for (let i = 0; i <= env.MEDIA_ECHO_MAX_PER_SESSION; i += 1) cache.set('s1', `m${i}`, { conversation: `${i}` });

    expect(cache.get('s1', 'm0')).toBeUndefined();
    expect(cache.get('s1', 'm1')).toEqual({ conversation: '1' });

    vi.advanceTimersByTime(env.MEDIA_ECHO_TTL_MS + 1);
    expect(cache.get('s1', 'm1')).toBeUndefined();
  });
});
