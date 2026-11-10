import { describe, it, expect } from 'vitest';
import { ExtensionSyncError, syncErrorMessage } from './useExtension';
import { extensionStrings } from '../strings';

const e = extensionStrings.errors;
const msg = (code: string) => syncErrorMessage(new ExtensionSyncError(code));

describe('syncErrorMessage', () => {
  it('só ml_not_logged fala de login no Mercado Livre', () => {
    expect(msg('ml_not_logged')).toBe(e.mlNotLogged);
    for (const code of ['api_unreachable', 'api_rejected', 'rate_limited', 'ml_sync_failed', 'unknown']) {
      expect(msg(code)).not.toBe(e.mlNotLogged);
    }
  });

  it('mapeia códigos conhecidos', () => {
    expect(msg('api_unreachable')).toBe(e.apiUnreachable);
    expect(msg('rate_limited')).toBe(e.rateLimited);
    expect(msg('ml_session_rejected')).toBe(e.mlSessionRejected);
    expect(msg('session_expired')).toBe(e.needsLogin);
    expect(msg('forbidden')).toBe(e.forbidden);
  });

  it('código desconhecido ou erro qualquer cai na falha genérica do servidor', () => {
    expect(msg('api_rejected')).toBe(e.syncFailed);
    expect(syncErrorMessage(new Error('x'))).toBe(e.syncFailed);
  });

  it('Shein: códigos próprios e consentimento cita a loja da operação', () => {
    expect(msg('shein_not_logged')).toBe(e.sheinNotLogged);
    expect(msg('shein_permission_missing')).toBe(e.sheinPermissionMissing);
    expect(msg('risk_not_accepted')).toBe(e.riskNotAccepted);
    expect(msg('consent_required')).toBe(e.consentRequired);
    expect(syncErrorMessage(new ExtensionSyncError('consent_required'), 'shein')).toBe(e.consentRequiredShein);
    expect(syncErrorMessage(new ExtensionSyncError('plan_unavailable'), 'shein')).toBe(e.planRequired);
  });
});
