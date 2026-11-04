import { describe, expect, it } from 'vitest';
import { AppError } from '../AppError';
import { EngineTemporarilyUnavailableError } from './MessagingErrors';
import { SessionLeaseHeldError } from './SessionErrors';

describe('SessionLeaseHeldError', () => {
  it('503 ENGINE_TEMPORARILY_UNAVAILABLE, distinguível por instanceof', () => {
    const e = new SessionLeaseHeldError('s1');
    expect(e).toBeInstanceOf(SessionLeaseHeldError);
    expect(e).toBeInstanceOf(EngineTemporarilyUnavailableError);
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ code: 'ENGINE_TEMPORARILY_UNAVAILABLE', statusCode: 503, sessionId: 's1', name: 'SessionLeaseHeldError' });
    expect(new EngineTemporarilyUnavailableError()).not.toBeInstanceOf(SessionLeaseHeldError);
  });
});
