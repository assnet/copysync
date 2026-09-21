import { describe, it, expect } from 'vitest';
import { shouldResync } from './shouldResync';

const AGORA = new Date('2026-09-21T12:00:00.000Z').getTime();

describe('shouldResync', () => {
  it('recarrega depois de queda de conexão acima de 5 segundos', () => {
    expect(shouldResync({ reason: 'reconnect', awayMs: 20_000, lastResyncAt: null, now: AGORA })).toBe(true);
  });

  it('ignora queda instantânea de conexão', () => {
    // O StrictMode do React conecta e desconecta na montagem; recarregar aí seria ruído.
    expect(shouldResync({ reason: 'reconnect', awayMs: 300, lastResyncAt: null, now: AGORA })).toBe(false);
  });

  it('ignora alternância rápida de janela', () => {
    // Alt-tab de 10 s não perdeu frame algum: o socket seguiu aberto e recebendo.
    expect(shouldResync({ reason: 'tab-visible', awayMs: 10_000, lastResyncAt: null, now: AGORA })).toBe(false);
  });

  it('recarrega quando a aba volta após minutos ocultos', () => {
    // Máquina suspensa devolve socket que o navegador considera aberto, sem os frames
    // do período dormido.
    expect(shouldResync({ reason: 'tab-visible', awayMs: 120_000, lastResyncAt: null, now: AGORA })).toBe(true);
  });

  it('respeita o intervalo mínimo entre dois resyncs', () => {
    expect(shouldResync({
      reason: 'reconnect', awayMs: 60_000, lastResyncAt: AGORA - 10_000, now: AGORA,
    })).toBe(false);
  });

  it('libera novo resync passado o intervalo mínimo', () => {
    expect(shouldResync({
      reason: 'reconnect', awayMs: 60_000, lastResyncAt: AGORA - 31_000, now: AGORA,
    })).toBe(true);
  });

  it('aplica o intervalo mínimo entre motivos diferentes', () => {
    // Reconectar e logo depois voltar à aba não pode gerar duas requisições.
    expect(shouldResync({
      reason: 'tab-visible', awayMs: 120_000, lastResyncAt: AGORA - 5_000, now: AGORA,
    })).toBe(false);
  });
});
