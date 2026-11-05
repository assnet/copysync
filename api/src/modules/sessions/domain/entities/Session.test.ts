import { describe, it, expect } from 'vitest';
import { makeSession } from '../../application/use-cases/sessionTestFakes';
import type { SessionStatus } from '../enums/SessionStatus';

const NOW = new Date('2026-11-04T12:00:00Z');
const REQ = new Date('2026-11-04T11:00:00Z');

describe('Session.isAwaitingCapacity', () => {
  it.each<SessionStatus>([
    'PENDING',
    'DISCONNECTED',
    'CONNECTING',
    'AWAITING_QR',
    'AWAITING_PAIRING',
    'AWAITING_CODE',
    'AWAITING_PASSWORD',
  ])('%s com pedido e sem lease → true', (status) => {
    expect(makeSession({ status, connectRequestedAt: REQ, leaseUntil: null }).isAwaitingCapacity(NOW)).toBe(true);
  });

  it.each<SessionStatus>(['CONNECTED', 'LOGGED_OUT', 'FAILED'])(
    '%s → false',
    (status) => {
      expect(makeSession({ status, connectRequestedAt: REQ, leaseUntil: null }).isAwaitingCapacity(NOW)).toBe(false);
    },
  );

  it('sem pedido → false (campos ausentes = null)', () => {
    expect(makeSession({ status: 'DISCONNECTED' }).isAwaitingCapacity(NOW)).toBe(false);
  });

  it('lease vivo → false; vencido ou no instante exato → true', () => {
    const at = (leaseUntil: Date) =>
      makeSession({ status: 'DISCONNECTED', connectRequestedAt: REQ, leaseUntil }).isAwaitingCapacity(NOW);
    expect(at(new Date(NOW.getTime() + 1))).toBe(false);
    expect(at(new Date(NOW.getTime()))).toBe(true);
    expect(at(new Date(NOW.getTime() - 60_000))).toBe(true);
  });

  it('AWAITING_QR com lease vivo (worker vivo segurando o login) → false', () => {
    const s = makeSession({ status: 'AWAITING_QR', connectRequestedAt: REQ, leaseUntil: new Date(NOW.getTime() + 1) });
    expect(s.isAwaitingCapacity(NOW)).toBe(false);
  });
});
