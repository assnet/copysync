import { describe, expect, expectTypeOf, it } from 'vitest';
import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';
import { MessagingEngineRouter } from '../MessagingEngineRouter';
import {
  ENGINE_CALL_PLAN,
  engineCall,
  engineCallKind,
  engineCallSessionId,
  isEngineMethod,
  type EngineMethod,
  type EngineMethodsOf,
} from './engineCallPlan';

/** Métodos do router que não são do contrato `IMessagingEngine` (ISessionSocketControl + internos). */
const NOT_CONTRACT = new Set([
  'constructor', 'abortSession', 'suspendSession', 'resumeSession', 'forgetSuspension', 'adoptSession', 'closeAllSockets', 'listLocalSessionIds',
  'listAuthenticatedSessionIds', 'hasStoredCredentials',
  'remember', 'pick', 'socketControls', 'resolve', 'resolveSync',
]);

function routerContractMethods(): string[] {
  const proto = MessagingEngineRouter.prototype;
  return Object.getOwnPropertyNames(proto).filter((n) => {
    const d = Object.getOwnPropertyDescriptor(proto, n);
    return !NOT_CONTRACT.has(n) && typeof d?.value === 'function';
  });
}

describe('engineCallPlan', () => {
  it('cobre exatamente os métodos do contrato (via implementação de referência)', () => {
    const router = routerContractMethods();
    expect(router).toEqual(expect.arrayContaining(Object.keys(ENGINE_CALL_PLAN)));
    // Método público novo no router sem entrada no plano (nem na lista de fora do contrato) quebra aqui.
    expect(router.filter((n) => !(n in ENGINE_CALL_PLAN))).toEqual([]);
    expectTypeOf<keyof typeof ENGINE_CALL_PLAN>().toEqualTypeOf<keyof IMessagingEngine>();
  });

  it('classes conforme a spec', () => {
    const byKind = (k: string) => Object.entries(ENGINE_CALL_PLAN).filter(([, v]) => v === k).map(([m]) => m).sort();
    expect(byKind('local')).toEqual(['createSession']);
    expect(byKind('command')).toEqual(['disconnectSession', 'logoutSession', 'sendMediaMessage', 'sendTextMessage']);
    expect(byKind('open')).toEqual(['connectSession', 'reconnectSession', 'requestLoginCode', 'requestPairingCode']);
    expect(byKind('rpc')).toHaveLength(17);
    for (const m of ['createOutboundMessageId', 'submitLoginCode', 'submitLoginPassword', 'getSessionStatus'] as const) {
      expect(engineCallKind(m)).toBe('rpc');
    }
    expectTypeOf<EngineMethodsOf<'command'>>().toEqualTypeOf<
      'disconnectSession' | 'logoutSession' | 'sendTextMessage' | 'sendMediaMessage'
    >();
  });

  it('isEngineMethod', () => {
    expect(isEngineMethod('sendTextMessage')).toBe(true);
    expect(isEngineMethod('closeAllSockets')).toBe(false);
    expect(isEngineMethod('toString')).toBe(false);
    expect(isEngineMethod(1)).toBe(false);
  });

  it('engineCallSessionId: string posicional ou input.sessionId', () => {
    expect(engineCallSessionId(engineCall('getSessionQr', 's1'))).toBe('s1');
    expect(engineCallSessionId(engineCall('sendPresence', 's2', '5511', 'composing'))).toBe('s2');
    expect(engineCallSessionId(engineCall('logoutSession', { sessionId: 's3', tenantId: 't' }))).toBe('s3');
    expect(engineCallSessionId(engineCall('updateChatState', { sessionId: 's4', chatId: 'c', isGroup: false }))).toBe('s4');
    expect(() => engineCallSessionId({ method: 'getSessionQr', args: [undefined as unknown as string] })).toThrow(TypeError);
  });

  it('tipos: args correlacionados ao método', () => {
    const m: EngineMethod = 'getSessionQr';
    expect(m).toBe('getSessionQr');
    // @ts-expect-error getSessionQr recebe sessionId string
    engineCall('getSessionQr', { sessionId: 's' });
  });
});
