import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';
import {
  InvalidSessionStateError,
  SessionNotConnectedError,
  SessionNotOwnedError,
} from '../../../../shared/errors/internal/SessionErrors';
import { EngineNotReadyError } from '../../../../shared/errors/internal/MessagingErrors';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import { ENGINE_CALL_PLAN, type EngineMethod } from './engineCallPlan';
import { SESSION_OPEN_TARGET } from './ports';
import { DEFAULT_REMOTE_ENGINE_TIMEOUTS, RemoteMessagingEngineAdapter, enabledEnginesFromEnv } from './RemoteMessagingEngineAdapter';

const S = 's1';
const T = 't1';
const W = 'worker-a';

/** Argumentos mínimos por método (só o roteamento importa). */
const ARGS: Record<EngineMethod, unknown[]> = {
  createSession: [{ sessionId: S, tenantId: T }],
  connectSession: [{ sessionId: S, tenantId: T }],
  reconnectSession: [{ sessionId: S, tenantId: T }],
  requestPairingCode: [{ sessionId: S, tenantId: T, phone: '5511' }],
  requestLoginCode: [{ sessionId: S, tenantId: T, phone: '5511' }],
  disconnectSession: [{ sessionId: S, tenantId: T }],
  logoutSession: [{ sessionId: S, tenantId: T }],
  sendTextMessage: [{ sessionId: S, tenantId: T, to: '5511', body: 'oi' }],
  sendMediaMessage: [{ sessionId: S, tenantId: T, to: '5511', messageId: 'm1', media: { kind: 'image', filePath: '/x', mimeType: 'image/jpeg', sizeBytes: 1 } }],
  getSessionStatus: [S],
  getSessionQr: [S],
  getSessionPairingCode: [S],
  submitLoginCode: [{ sessionId: S, tenantId: T, code: '1' }],
  submitLoginPassword: [{ sessionId: S, tenantId: T, password: 'p' }],
  createOutboundMessageId: [S],
  sendReaction: [{ sessionId: S, tenantId: T, target: { externalId: 'e', remoteJid: 'r', fromMe: false }, emoji: null, reactedAt: new Date(0) }],
  markMessagesRead: [{ sessionId: S, tenantId: T, remoteJid: 'r', messageIds: ['a'] }],
  presenceSubscribe: [S, '5511'],
  sendPresence: [S, '5511', 'composing'],
  getGroupParticipants: [S, 'g'],
  listParticipatingGroups: [S],
  getGroupInviteLink: [S, 'g'],
  getGroupSummary: [S, 'g'],
  fetchProfilePicture: [S, '5511', false],
  checkNumberExists: [S, '5511'],
  updateChatState: [{ sessionId: S, chatId: 'c', isGroup: false }],
};

function setup(owner: string | null = W) {
  const owners = { findLiveOwner: vi.fn(async (_id: string) => owner) };
  const rpc = { call: vi.fn(async (_w: string, _c: unknown): Promise<unknown> => 'rpc-result'), close: vi.fn() };
  const commands = { send: vi.fn(async (_t: string, _c: unknown, _ms: number): Promise<unknown> => 'cmd-result'), close: vi.fn() };
  const adapter = new RemoteMessagingEngineAdapter({
    owners,
    rpc: rpc as never,
    commands: commands as never,
    // Identidade: o roteamento não depende da chave (fluxo de mídia em outboundMediaTransfer.test.ts).
    mediaTransfer: { stage: async (p: string) => p, discard: async () => undefined },
    enabledEngines: new Set(['baileys']),
  });
  const invoke = (m: EngineMethod) =>
    (adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m](...ARGS[m]);
  return { owners, rpc, commands, adapter, invoke };
}

const methodsOf = (k: string) => (Object.keys(ENGINE_CALL_PLAN) as EngineMethod[]).filter((m) => ENGINE_CALL_PLAN[m] === k);

describe('RemoteMessagingEngineAdapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('implementa todo método do contrato', () => {
    const { adapter } = setup();
    for (const m of Object.keys(ENGINE_CALL_PLAN)) {
      expect(typeof (adapter as unknown as IMessagingEngine)[m as EngineMethod], m).toBe('function');
    }
  });

  it.each(methodsOf('rpc'))('rpc %s → RPC no dono vivo', async (m) => {
    const { invoke, rpc, commands, owners } = setup();
    await expect(invoke(m)).resolves.toBe('rpc-result');
    expect(owners.findLiveOwner).toHaveBeenCalledWith(S);
    expect(rpc.call).toHaveBeenCalledWith(W, { method: m, args: ARGS[m] });
    expect(commands.send).not.toHaveBeenCalled();
  });

  it.each(methodsOf('command'))('command %s → fila do dono', async (m) => {
    const { invoke, rpc, commands } = setup();
    await expect(invoke(m)).resolves.toBe('cmd-result');
    const ms = m === 'sendMediaMessage' ? DEFAULT_REMOTE_ENGINE_TIMEOUTS.mediaMs : DEFAULT_REMOTE_ENGINE_TIMEOUTS.commandMs;
    expect(commands.send).toHaveBeenCalledWith(W, { method: m, args: ARGS[m] }, ms);
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it.each(methodsOf('open'))('open %s → fila do dono vivo', async (m) => {
    const { invoke, commands } = setup();
    await invoke(m);
    expect(commands.send).toHaveBeenCalledWith(W, { method: m, args: ARGS[m] }, DEFAULT_REMOTE_ENGINE_TIMEOUTS.commandMs);
  });

  it.each(methodsOf('open'))('open %s sem dono → session-open', async (m) => {
    const { invoke, commands } = setup(null);
    await invoke(m);
    expect(commands.send).toHaveBeenCalledWith(SESSION_OPEN_TARGET, { method: m, args: ARGS[m] }, DEFAULT_REMOTE_ENGINE_TIMEOUTS.commandMs);
  });

  it.each(methodsOf('command'))('command %s sem dono → SessionNotConnectedError, nada enfileirado', async (m) => {
    const { invoke, commands } = setup(null);
    await expect(invoke(m)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(commands.send).not.toHaveBeenCalled();
  });

  describe('rpc sem dono', () => {
    const benign: Partial<Record<EngineMethod, unknown>> = {
      getSessionStatus: 'DISCONNECTED',
      getSessionQr: null,
      getSessionPairingCode: null,
      fetchProfilePicture: null,
      checkNumberExists: null,
      markMessagesRead: undefined,
      presenceSubscribe: undefined,
    };
    const loginSteps: EngineMethod[] = ['submitLoginCode', 'submitLoginPassword'];

    it.each(Object.keys(benign) as EngineMethod[])('%s → resposta da engine local sem socket', async (m) => {
      const { invoke, rpc } = setup(null);
      await expect(invoke(m)).resolves.toBe(benign[m]);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it.each(loginSteps)('%s → InvalidSessionStateError', async (m) => {
      const { invoke, rpc } = setup(null);
      await expect(invoke(m)).rejects.toBeInstanceOf(InvalidSessionStateError);
      expect(rpc.call).not.toHaveBeenCalled();
    });

    it.each(methodsOf('rpc').filter((m) => !(m in benign) && !loginSteps.includes(m)))('%s → SessionNotConnectedError', async (m) => {
      const { invoke, rpc } = setup(null);
      await expect(invoke(m)).rejects.toBeInstanceOf(SessionNotConnectedError);
      expect(rpc.call).not.toHaveBeenCalled();
    });
  });

  it('createSession só emite SESSION_CREATED local', async () => {
    const { adapter, owners, rpc, commands } = setup();
    const emit = vi.spyOn(internalEventBus, 'emit');
    await adapter.createSession({ sessionId: S, tenantId: T });
    expect(emit).toHaveBeenCalledWith('SESSION_CREATED', { type: 'SESSION_CREATED', sessionId: S, tenantId: T });
    expect(owners.findLiveOwner).not.toHaveBeenCalled();
    expect(rpc.call).not.toHaveBeenCalled();
    expect(commands.send).not.toHaveBeenCalled();
  });

  describe('SESSION_NOT_OWNED', () => {
    it('rpc re-resolve o dono uma vez e vai ao novo dono', async () => {
      const { adapter, owners, rpc } = setup();
      owners.findLiveOwner.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
      rpc.call.mockRejectedValueOnce(new SessionNotOwnedError(S)).mockResolvedValueOnce('CONNECTED');
      await expect(adapter.getSessionStatus(S)).resolves.toBe('CONNECTED');
      expect(owners.findLiveOwner).toHaveBeenCalledTimes(2);
      expect(rpc.call.mock.calls.map((c) => c[0])).toEqual(['old', 'new']);
    });

    it('command re-resolve; sem novo dono → SessionNotConnectedError', async () => {
      const { adapter, owners, commands } = setup();
      owners.findLiveOwner.mockResolvedValueOnce('old').mockResolvedValueOnce(null);
      commands.send.mockRejectedValueOnce(new SessionNotOwnedError(S));
      await expect(adapter.sendTextMessage(ARGS.sendTextMessage[0] as never)).rejects.toBeInstanceOf(SessionNotConnectedError);
      expect(commands.send).toHaveBeenCalledTimes(1);
    });

    it('open re-resolve; sem novo dono → session-open', async () => {
      const { adapter, owners, commands } = setup();
      owners.findLiveOwner.mockResolvedValueOnce('old').mockResolvedValueOnce(null);
      commands.send.mockRejectedValueOnce(new SessionNotOwnedError(S)).mockResolvedValueOnce({});
      await adapter.connectSession({ sessionId: S, tenantId: T });
      expect(commands.send.mock.calls.map((c) => c[0])).toEqual(['old', SESSION_OPEN_TARGET]);
    });

    it('só uma re-tentativa: 2º SESSION_NOT_OWNED → EngineNotReadyError (interno não vaza)', async () => {
      const { adapter, owners, rpc } = setup();
      rpc.call.mockRejectedValue(new SessionNotOwnedError(S));
      await expect(adapter.getSessionQr(S)).rejects.toBeInstanceOf(EngineNotReadyError);
      expect(rpc.call).toHaveBeenCalledTimes(2);
      expect(owners.findLiveOwner).toHaveBeenCalledTimes(2);
    });

    it('outro erro tipado passa sem re-tentativa', async () => {
      const { adapter, rpc } = setup();
      rpc.call.mockRejectedValueOnce(new SessionNotConnectedError(S));
      await expect(adapter.listParticipatingGroups(S)).rejects.toBeInstanceOf(SessionNotConnectedError);
      expect(rpc.call).toHaveBeenCalledTimes(1);
    });
  });

  it('timeouts configuráveis', async () => {
    const commands = { send: vi.fn(async () => undefined), close: vi.fn() };
    const adapter = new RemoteMessagingEngineAdapter({
      owners: { findLiveOwner: async () => W },
      rpc: { call: vi.fn(), close: vi.fn() } as never,
      commands: commands as never,
      mediaTransfer: { stage: async (p: string) => p, discard: async () => undefined },
      enabledEngines: new Set(['baileys']),
      timeouts: { commandMs: 5 },
    });
    await adapter.logoutSession({ sessionId: S, tenantId: T });
    expect(commands.send).toHaveBeenCalledWith(W, expect.anything(), 5);
  });

  it('não implementa ISessionSocketControl', () => {
    const { adapter } = setup();
    for (const m of ['abortSession', 'suspendSession', 'resumeSession', 'forgetSuspension', 'closeAllSockets', 'listLocalSessionIds']) {
      expect((adapter as unknown as Record<string, unknown>)[m]).toBeUndefined();
    }
  });

  it('enabledEngines vem da config', () => {
    expect(setup().adapter.enabledEngines).toEqual(new Set(['baileys']));
  });

  it('não importa Baileys nem GramJS', () => {
    const src = readFileSync(join(__dirname, 'RemoteMessagingEngineAdapter.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import|} from)|require\(/.test(l)).join('\n');
    expect(imports).not.toMatch(/baileys|telegram|engines\//i);
  });
});

describe('enabledEnginesFromEnv', () => {
  const base = { telegramEnabled: true, telegramApiId: 1, telegramApiHash: 'h', cipherProblem: null };
  it('telegram só com flag, credenciais e cifra', () => {
    expect(enabledEnginesFromEnv(base)).toEqual(new Set(['baileys', 'telegram']));
    expect(enabledEnginesFromEnv({ ...base, telegramEnabled: false })).toEqual(new Set(['baileys']));
    expect(enabledEnginesFromEnv({ ...base, telegramApiHash: undefined })).toEqual(new Set(['baileys']));
    expect(enabledEnginesFromEnv({ ...base, cipherProblem: 'sem chave' })).toEqual(new Set(['baileys']));
  });
});
