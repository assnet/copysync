import { describe, expect, it } from 'vitest';
import { linkDomainErrorMessage, probeReasonMessage } from './errors';
import { linkDomainsAdminStrings as s } from './strings';

describe('linkDomainErrorMessage', () => {
  it.each(['LINK_DOMAIN_INVALID', 'LINK_DOMAIN_TAKEN', 'LINK_DOMAIN_IN_USE', 'LINK_ROTATION_NOT_CONFIGURED'])(
    'traduz %s',
    (code) => {
      const msg = linkDomainErrorMessage(Object.assign(new Error('x'), { code }));
      expect(msg).toBe(s.errors[code]);
      expect(msg).not.toBe(s.errors.generic);
    },
  );

  it('cai no genérico sem código ou com código desconhecido', () => {
    expect(linkDomainErrorMessage(new Error('boom'))).toBe(s.errors.generic);
    expect(linkDomainErrorMessage({ code: 'OUTRO' })).toBe(s.errors.generic);
    expect(linkDomainErrorMessage(null)).toBe(s.errors.generic);
  });
});

describe('probeReasonMessage', () => {
  it.each(['REDIRECT', 'UNEXPECTED_STATUS', 'TIMEOUT', 'NETWORK_ERROR', 'BLOCKED_ADDRESS', 'UNRESOLVABLE'] as const)(
    'traduz %s',
    (reason) => {
      expect(probeReasonMessage({ reason, status: null })).toBe(s.probe.reasons[reason]);
    },
  );

  it('anexa o código HTTP quando existe', () => {
    expect(probeReasonMessage({ reason: 'REDIRECT', status: 301 })).toBe(`${s.probe.reasons.REDIRECT} (resposta HTTP 301)`);
  });

  it('motivo ausente vira texto neutro', () => {
    expect(probeReasonMessage({ reason: null, status: null })).toBe(s.probe.unknownReason);
  });
});
