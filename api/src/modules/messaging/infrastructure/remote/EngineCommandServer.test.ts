import { describe, expect, it, vi } from 'vitest';
import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';
import { SessionLeaseHeldError, SessionNotOwnedError } from '../../../../shared/errors/internal/SessionErrors';
import { EngineCommandServer } from './EngineCommandServer';
import type { EngineCall } from './engineCallPlan';

const call = (method: string, ...args: unknown[]) => ({ method, args }) as unknown as EngineCall;

function setup(local: string[] = ['s1']) {
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const engine = new Proxy({}, {
    get: (_t, name: string) => {
      if (!fns.has(name)) fns.set(name, vi.fn().mockResolvedValue(`${name}:ok`));
      return fns.get(name);
    },
  }) as IMessagingEngine;
  const fn = (name: string) => (engine as unknown as Record<string, ReturnType<typeof vi.fn>>)[name];
  const release = { execute: vi.fn().mockResolvedValue(undefined) };
  const server = new EngineCommandServer(engine, { listLocalSessionIds: () => local }, release);
  return { server, fn, release };
}

describe('EngineCommandServer', () => {
  it('rpc de sessão local executa com os argumentos', async () => {
    const { server, fn } = setup();
    await expect(server.handle(call('getSessionStatus', 's1'))).resolves.toBe('getSessionStatus:ok');
    expect(fn('getSessionStatus')).toHaveBeenCalledWith('s1');
  });

  it.each([
    ['rpc', call('getSessionStatus', 's2')],
    ['command', call('sendTextMessage', { sessionId: 's2', to: 'x', text: 'oi' })],
  ])('%s de sessão alheia → SESSION_NOT_OWNED sem tocar a engine', async (_k, c) => {
    const { server, fn, release } = setup();
    const err = await server.handle(c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionNotOwnedError);
    expect((err as SessionNotOwnedError).code).toBe('SESSION_NOT_OWNED');
    expect(fn(c.method)).not.toHaveBeenCalled();
    expect(release.execute).not.toHaveBeenCalled();
  });

  it('open não checa posse; SessionLeaseHeldError volta como erro', async () => {
    const { server, fn } = setup([]);
    await expect(server.handle(call('connectSession', { sessionId: 's9' }))).resolves.toBe('connectSession:ok');
    fn('reconnectSession').mockRejectedValueOnce(new SessionLeaseHeldError('s9'));
    await expect(server.handle(call('reconnectSession', { sessionId: 's9' }))).rejects.toBeInstanceOf(SessionLeaseHeldError);
  });

  it.each(['disconnectSession', 'logoutSession'])('%s solta o lease depois', async (m) => {
    const { server, fn, release } = setup();
    await server.handle(call(m, { sessionId: 's1' }));
    expect(release.execute).toHaveBeenCalledWith('s1');
    expect(fn(m).mock.invocationCallOrder[0]).toBeLessThan(release.execute.mock.invocationCallOrder[0]);
  });

  it.each(['disconnectSession', 'logoutSession'])('%s solta o lease mesmo se a engine lançar', async (m) => {
    const { server, fn, release } = setup();
    const boom = new Error('boom');
    fn(m).mockRejectedValueOnce(boom);
    await expect(server.handle(call(m, { sessionId: 's1' }))).rejects.toBe(boom);
    expect(release.execute).toHaveBeenCalledWith('s1');
  });

  it('outros comandos não soltam o lease', async () => {
    const { server, release } = setup();
    await server.handle(call('sendTextMessage', { sessionId: 's1', to: 'x', text: 'oi' }));
    expect(release.execute).not.toHaveBeenCalled();
  });
});
