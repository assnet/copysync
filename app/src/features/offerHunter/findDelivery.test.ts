import { describe, expect, it } from 'vitest';
import { huntFind } from './test/fixtures';
import type { HuntFindDispatchStatus } from './types';
import { findResendState, findSentAtLabel, findStatusChip } from './findDelivery';

describe('findDelivery', () => {
  it('status real do disparo no lugar do SENT do achado', () => {
    const sent = (dispatchStatus: HuntFindDispatchStatus | null) =>
      findStatusChip(huntFind('1', { status: 'SENT', offerId: 'o1', dispatchStatus })).label;
    expect(sent('QUEUED')).toBe('Na fila de envio');
    expect(sent('SENDING')).toBe('Na fila de envio');
    expect(sent('SENT')).toBe('Enviado');
    expect(sent('FAILED')).toBe('Falhou ao enviar');
    expect(sent('SKIPPED')).toBe('Não enviado');
    expect(sent('CANCELLED')).toBe('Não enviado');
    expect(sent(null)).toBe('Na fila de envio');
    expect(findStatusChip(huntFind('2')).label).toBe('Aguardando revisão');
  });

  it('hora só com SENT', () => {
    expect(findSentAtLabel(huntFind('1', { dispatchStatus: 'SENT', sentAt: '2026-11-12T15:00:00.000Z' }))).toMatch(/^Enviado em /);
    expect(findSentAtLabel(huntFind('1', { dispatchStatus: 'QUEUED', sentAt: null }))).toBeNull();
  });

  it('reenviar: some sem oferta, trava na fila, libera depois', () => {
    expect(findResendState(huntFind('1'))).toBe('hidden');
    expect(findResendState(huntFind('1', { offerId: 'o1', dispatchStatus: 'QUEUED' }))).toBe('pending');
    expect(findResendState(huntFind('1', { offerId: 'o1', dispatchStatus: 'SENT' }))).toBe('ready');
    expect(findResendState(huntFind('1', { offerId: 'o1', dispatchStatus: 'FAILED' }))).toBe('ready');
  });
});
