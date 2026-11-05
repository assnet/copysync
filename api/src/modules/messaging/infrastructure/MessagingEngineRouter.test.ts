import { describe, expect, it, vi } from 'vitest';
import { MessagingEngineRouter } from './MessagingEngineRouter';
import type { IMessagingEngine } from '../domain/contracts/IMessagingEngine';
import { SessionNotFoundError } from '../../../shared/errors/internal/SessionErrors';

function fakeEngine(name: string) {
  return {
    name,
    connectSession: vi.fn(async () => ({})),
    createOutboundMessageId: vi.fn(async () => `${name}-id`),
    getSessionStatus: vi.fn(async () => 'CONNECTED'),
    abortSession: vi.fn(async () => undefined),
    suspendSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => 'resumed'),
    forgetSuspension: vi.fn(async () => (name === 'telegram' ? 't1' : null)),
    adoptSession: vi.fn(async () => 'held'),
    closeAllSockets: vi.fn(async () => undefined),
    listLocalSessionIds: vi.fn(() => [`${name}-s`]),
  } as unknown as IMessagingEngine & {
    name: string;
    connectSession: ReturnType<typeof vi.fn>;
    createOutboundMessageId: ReturnType<typeof vi.fn>;
    abortSession: ReturnType<typeof vi.fn>;
    suspendSession: ReturnType<typeof vi.fn>;
    resumeSession: ReturnType<typeof vi.fn>;
    forgetSuspension: ReturnType<typeof vi.fn>;
    adoptSession: ReturnType<typeof vi.fn>;
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

  it('id de saída usa o cache; sem cache cai na engine padrão', async () => {
    const { router } = build({ s1: 'telegram' });
    await expect(router.createOutboundMessageId('s1')).resolves.toBe('baileys-id');
    await router.getSessionStatus('s1');
    await expect(router.createOutboundMessageId('s1')).resolves.toBe('telegram-id');
  });

  it('exige a engine padrão', () => {
    expect(() => new MessagingEngineRouter(new Map([['telegram', fakeEngine('telegram')]]), { findEngineById: async () => null })).toThrow();
  });

  it('abortSession vai só para a engine da sessão', async () => {
    const { router, telegram, baileys } = build({ s1: 'telegram' });
    await router.abortSession('s1');
    expect(telegram.abortSession).toHaveBeenCalledWith('s1', undefined);
    expect(baileys.abortSession).not.toHaveBeenCalled();
  });

  it('abortSession de sessão sem engine conhecida pede a todas', async () => {
    const { router, telegram, baileys } = build({});
    await router.abortSession('gone');
    expect(telegram.abortSession).toHaveBeenCalledWith('gone', undefined);
    expect(baileys.abortSession).toHaveBeenCalledWith('gone', undefined);
  });

  it('abortSession repassa onlyAuto (desistência da retomada) à engine e, sem engine, a todas', async () => {
    const { router, telegram, baileys } = build({ s1: 'telegram' });
    await router.abortSession('s1', { onlyAuto: true });
    expect(telegram.abortSession).toHaveBeenCalledWith('s1', { onlyAuto: true });
    await router.abortSession('gone', { onlyAuto: true });
    expect(baileys.abortSession).toHaveBeenCalledWith('gone', { onlyAuto: true });
  });

  it('adoptSession vai só para a engine da sessão e devolve o resultado dela', async () => {
    const { router, baileys, telegram } = build({ s1: 'telegram' });
    expect(await router.adoptSession('s1', 't1')).toBe('held');
    expect(telegram.adoptSession).toHaveBeenCalledWith('s1', 't1');
    expect(baileys.adoptSession).not.toHaveBeenCalled();
  });

  it('adoptSession de sessão apagada lança SESSION_NOT_FOUND', async () => {
    const { router } = build({});
    await expect(router.adoptSession('gone', 't1')).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('suspendSession/resumeSession vão só para a engine da sessão', async () => {
    const { router, baileys, telegram } = build({ s1: 'telegram' });
    await router.suspendSession('s1');
    expect(await router.resumeSession('s1')).toBe('resumed');
    expect(telegram.suspendSession).toHaveBeenCalledWith('s1');
    expect(telegram.resumeSession).toHaveBeenCalledWith('s1');
    expect(baileys.suspendSession).not.toHaveBeenCalled();
    expect(baileys.resumeSession).not.toHaveBeenCalled();
  });

  it('sessão sem engine conhecida: suspende em todas, não reabre', async () => {
    const { router, baileys, telegram } = build({});
    await router.suspendSession('gone');
    expect(baileys.suspendSession).toHaveBeenCalledWith('gone');
    expect(telegram.suspendSession).toHaveBeenCalledWith('gone');
    expect(await router.resumeSession('gone')).toBe('gone');
    expect(baileys.resumeSession).not.toHaveBeenCalled();
  });

  it('forgetSuspension pede a todas sem ir ao banco e devolve o tenant guardado', async () => {
    const { router, baileys, telegram, repo } = build({ s1: 'telegram' });
    expect(await router.forgetSuspension('s1')).toBe('t1');
    expect(baileys.forgetSuspension).toHaveBeenCalledWith('s1');
    expect(telegram.forgetSuspension).toHaveBeenCalledWith('s1');
    expect(repo.findEngineById).not.toHaveBeenCalled();
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
