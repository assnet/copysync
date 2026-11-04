import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { registerSessionAdoptionResetListener } from './SessionAdoptionResetListener';

function connect(sessionId = 's1') {
  internalEventBus.emit('SESSION_CONNECTED', { type: 'SESSION_CONNECTED', sessionId, tenantId: 't1' });
}

afterEach(() => {
  internalEventBus.removeAllListeners('SESSION_CONNECTED');
});

describe('registerSessionAdoptionResetListener', () => {
  it('SESSION_CONNECTED zera o backoff uma vez', async () => {
    const repo = { resetFailures: vi.fn(async () => undefined) };
    registerSessionAdoptionResetListener(repo);
    connect('s1');
    await vi.waitFor(() => expect(repo.resetFailures).toHaveBeenCalledTimes(1));
    expect(repo.resetFailures).toHaveBeenCalledWith('s1');
  });

  it('erro do repositório não propaga', async () => {
    const repo = { resetFailures: vi.fn(async () => { throw new Error('db'); }) };
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      registerSessionAdoptionResetListener(repo);
      expect(() => connect()).not.toThrow();
      await vi.waitFor(() => expect(repo.resetFailures).toHaveBeenCalledTimes(1));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a função devolvida remove o listener', async () => {
    const repo = { resetFailures: vi.fn(async () => undefined) };
    const off = registerSessionAdoptionResetListener(repo);
    off();
    connect();
    await new Promise((r) => setImmediate(r));
    expect(repo.resetFailures).not.toHaveBeenCalled();
  });
});
