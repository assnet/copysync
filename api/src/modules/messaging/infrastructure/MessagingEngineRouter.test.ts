import { describe, expect, it, vi } from 'vitest';
import { MessagingEngineRouter } from './MessagingEngineRouter';
import type { IMessagingEngine } from '../domain/contracts/IMessagingEngine';
import { SessionNotFoundError } from '../../../shared/errors/internal/SessionErrors';

function fakeEngine(name: string) {
  return {
    name,
    connectSession: vi.fn(async () => ({})),
    createOutboundMessageId: vi.fn(() => `${name}-id`),
    getSessionStatus: vi.fn(async () => 'CONNECTED'),
    abortSession: vi.fn(async () => undefined),
    closeAllSockets: vi.fn(async () => undefined),
    listLocalSessionIds: vi.fn(() => [`${name}-s`]),
  } as unknown as IMessagingEngine & {
    name: string;
    connectSession: ReturnType<typeof vi.fn>;
    createOutboundMessageId: ReturnType<typeof vi.fn>;
    abortSession: ReturnType<typeof vi.fn>;
    closeAllSockets: ReturnType<typeof vi.fn>;
    listLocalSessionIds: ReturnType<typeof vi.fn>;
  };
}

function build(engineOf: Record<string, string>) {
  const baileys = fakeEngine('baileys');
  const telegram = fakeEngine('telegram');
  const repo = { findEngineById: vi.fn(async (id: string) => engineOf[id] ?? null) };
  const router = new MessagingEngineRouter(new Map([['baileys', baileys], ['telegram', telegram]]), repo);
  return { router, baileys, telegram, repo };
}

describe('MessagingEngineRouter', () => {
  it('despacha pela engine da sessão e guarda em cache', async () => {
    const { router, telegram, baileys, repo } = build({ s1: 'telegram' });
    await router.connectSession({ sessionId: 's1', tenantId: 't1' });
    await router.getSessionStatus('s1');
    expect(telegram.connectSession).toHaveBeenCalledTimes(1);
    expect(baileys.connectSession).not.toHaveBeenCalled();
    expect(repo.findEngineById).toHaveBeenCalledTimes(1);
  });

  it('sessão inexistente → SESSION_NOT_FOUND', async () => {
    const { router } = build({});
    await expect(router.getSessionStatus('nope')).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('id síncrono usa o cache; sem cache cai na engine padrão', async () => {
    const { router } = build({ s1: 'telegram' });
    expect(router.createOutboundMessageId('s1')).toBe('baileys-id');
    await router.getSessionStatus('s1');
    expect(router.createOutboundMessageId('s1')).toBe('telegram-id');
  });

  it('exige a engine padrão', () => {
    expect(() => new MessagingEngineRouter(new Map([['telegram', fakeEngine('telegram')]]), { findEngineById: async () => null })).toThrow();
  });

  it('abortSession vai só para a engine da sessão', async () => {
    const { router, telegram, baileys } = build({ s1: 'telegram' });
    await router.abortSession('s1');
    expect(telegram.abortSession).toHaveBeenCalledWith('s1');
    expect(baileys.abortSession).not.toHaveBeenCalled();
  });

  it('abortSession de sessão sem engine conhecida pede a todas', async () => {
    const { router, telegram, baileys } = build({});
    await router.abortSession('gone');
    expect(telegram.abortSession).toHaveBeenCalledWith('gone');
    expect(baileys.abortSession).toHaveBeenCalledWith('gone');
  });

  it('closeAllSockets espera todas mesmo se uma falhar', async () => {
    const { router, telegram, baileys } = build({});
    let telegramDone = false;
    baileys.closeAllSockets.mockRejectedValueOnce(new Error('boom'));
    telegram.closeAllSockets.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 5));
      telegramDone = true;
    });
    await expect(router.closeAllSockets()).resolves.toBeUndefined();
    expect(baileys.closeAllSockets).toHaveBeenCalledTimes(1);
    expect(telegramDone).toBe(true);
  });

  it('listLocalSessionIds junta os ids das duas engines', () => {
    const { router } = build({});
    expect(router.listLocalSessionIds().sort()).toEqual(['baileys-s', 'telegram-s']);
  });
});
