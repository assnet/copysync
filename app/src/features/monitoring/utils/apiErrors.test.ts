import { describe, expect, it } from 'vitest';
import { MonitoringUiError, monitoringErrorMessage, sessionGroupCap, uiErrorMessage } from './apiErrors';
import { monitoringStrings } from '../strings';

const err = (code: string, meta?: Record<string, unknown>) =>
  Object.assign(new Error(`raw english ${code}: 0b7c-uuid`), { code, meta });

describe('monitoringErrorMessage', () => {
  it('nunca devolve a mensagem crua da API', () => {
    const msg = monitoringErrorMessage(err('SESSION_NOT_CONNECTED'), { scope: 'groups' });
    expect(msg).toBe(monitoringStrings.errors.sessionNotConnected);
    expect(monitoringErrorMessage(err('ALGO_NOVO'), { scope: 'groups' })).toBe(monitoringStrings.errors.generic);
    expect(monitoringErrorMessage(new Error('boom'), { scope: 'settings' })).toBe(monitoringStrings.errors.generic);
    expect(monitoringErrorMessage(null, { scope: 'settings' })).toBe(monitoringStrings.errors.generic);
  });

  it('engine fora do ar e NOT_FOUND conforme o contexto', () => {
    expect(monitoringErrorMessage(err('ENGINE_NOT_READY'), { scope: 'groups' })).toMatch(/não respondeu/);
    expect(monitoringErrorMessage(err('ENGINE_TEMPORARILY_UNAVAILABLE'), { scope: 'groups' })).toMatch(/não respondeu/);
    expect(monitoringErrorMessage(err('NOT_FOUND'), { scope: 'groups' })).toBe('Grupo não encontrado nesta sessão. Atualize a lista e escolha de novo.');
    expect(monitoringErrorMessage(err('NOT_FOUND'), { scope: 'captured' })).toBe(monitoringStrings.errors.capturedNotFound);
  });

  it('conflito cita o grupo pelo nome e o papel', () => {
    const msg = monitoringErrorMessage(err('GROUP_MONITOR_GROUP_CONFLICT', { groupJid: 'g1@g.us', role: 'broadcast' }), {
      scope: 'groups', groupTitle: (jid) => (jid === 'g1@g.us' ? 'Promo' : null),
    });
    expect(msg).toBe('O grupo "Promo" já é grupo de disparo (nesta ou em outra sessão). O mesmo grupo não pode ser origem e destino.');
    expect(msg).not.toContain('g1@g.us');
  });

  it('campo inválido traduzido, limite e recurso do plano, oferta não recuperável', () => {
    expect(monitoringErrorMessage(err('GROUP_MONITOR_INVALID_INPUT', { field: 'typingSeconds' }), { scope: 'settings' })).toContain('Tempo digitando');
    expect(monitoringErrorMessage(err('GROUP_MONITOR_INVALID_INPUT', { field: 'x' }), { scope: 'settings' })).toBe(monitoringStrings.errors.invalidInput(null));
    expect(monitoringErrorMessage(err('PLAN_LIMIT_REACHED', { limit: 3 }), { scope: 'groups', max: 9 })).toContain('até 3 grupos');
    expect(monitoringErrorMessage(err('PLAN_LIMIT_REACHED'), { scope: 'groups', max: 9 })).toContain('até 9 grupos');
    expect(monitoringErrorMessage(err('PLAN_FEATURE_UNAVAILABLE'), { scope: 'settings' })).toBe(monitoringStrings.errors.planFeature);
    expect(monitoringErrorMessage(err('CAPTURED_OFFER_NOT_RETRYABLE'), { scope: 'captured' })).toBe(monitoringStrings.errors.notRetryable);
  });

  it('erro já traduzido passa como está', () => {
    expect(uiErrorMessage(new MonitoringUiError('Pronto'), { scope: 'groups' })).toBe('Pronto');
  });
});

describe('sessionGroupCap', () => {
  it('limite menos o uso das outras sessões', () => {
    expect(sessionGroupCap(null, 3, 1)).toBeNull();
    expect(sessionGroupCap(5, 4, 1)).toBe(2);
    expect(sessionGroupCap(2, 5, 1)).toBe(0);
  });
});

describe('tempo até o 1º envio', () => {
  it('segundos abaixo de 1 min; min e s acima', () => {
    const f = monitoringStrings.captured.remaining;
    expect(f(45)).toBe('45 s');
    expect(f(170)).toBe('2 min 50 s');
    expect(f(120)).toBe('2 min');
    expect(f(3900)).toBe('1 h 5 min');
  });
});
