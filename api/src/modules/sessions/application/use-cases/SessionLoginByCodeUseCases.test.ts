import { describe, it, expect, vi } from 'vitest';
import {
  RequestSessionLoginCodeUseCase,
  SubmitSessionLoginCodeUseCase,
  SubmitSessionLoginPasswordUseCase,
} from './SessionLoginByCodeUseCases';
import { makeAuditRepo, makeSession, makeSessionRepo } from './sessionTestFakes';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { SessionProps } from '../../domain/entities/Session';
import {
  SessionAlreadyConnectedError,
  SessionPhoneInvalidError,
} from '../../../../shared/errors/internal/SessionErrors';
import { EngineOperationUnsupportedError } from '../../../../shared/errors/internal/MessagingErrors';

const base = { sessionId: 's1', tenantId: 't1' };

function build(overrides: Partial<SessionProps> = {}) {
  const calls: string[] = [];
  const repo = makeSessionRepo(makeSession({ engine: 'telegram', declaredPhone: '+5511987654321', ...overrides }));
  repo.markConnectRequested.mockImplementation(async () => { calls.push('mark'); });
  const step = (status: string) => vi.fn(async () => { calls.push('engine'); return { status }; });
  const engine = {
    requestLoginCode: step('AWAITING_LOGIN_CODE'),
    submitLoginCode: step('CONNECTING'),
    submitLoginPassword: step('CONNECTING'),
  } as unknown as IMessagingEngine & Record<'requestLoginCode' | 'submitLoginCode' | 'submitLoginPassword', ReturnType<typeof vi.fn>>;
  const audit = makeAuditRepo();
  return {
    calls,
    repo,
    engine,
    sendCode: new RequestSessionLoginCodeUseCase(repo, audit, engine),
    signIn: new SubmitSessionLoginCodeUseCase(repo, audit, engine),
    password: new SubmitSessionLoginPasswordUseCase(repo, audit, engine),
  };
}

type Ctx = ReturnType<typeof build>;
const steps: Array<{ name: string; method: 'requestLoginCode' | 'submitLoginCode' | 'submitLoginPassword'; run: (c: Ctx) => Promise<unknown> }> = [
  { name: 'send-code', method: 'requestLoginCode', run: (c) => c.sendCode.execute({ ...base, userId: 'u1' }) },
  { name: 'sign-in', method: 'submitLoginCode', run: (c) => c.signIn.execute({ ...base, code: '12 345' }) },
  { name: 'password', method: 'submitLoginPassword', run: (c) => c.password.execute({ ...base, password: 'x' }) },
];

describe('SessionLoginByCodeUseCases — pedido de conexão (LEASE-07)', () => {
  for (const s of steps) {
    describe(s.name, () => {
      it('marca depois da validação e antes da engine', async () => {
        const c = build();
        await s.run(c);
        expect(c.repo.markConnectRequested).toHaveBeenCalledWith('s1', 't1');
        expect(c.calls).toEqual(['mark', 'engine']);
      });

      it('sessão conectada não marca nem chama a engine', async () => {
        const c = build({ status: 'CONNECTED' });
        await expect(s.run(c)).rejects.toBeInstanceOf(SessionAlreadyConnectedError);
        expect(c.repo.markConnectRequested).not.toHaveBeenCalled();
        expect(c.engine[s.method]).not.toHaveBeenCalled();
      });

      it('sessão que não é Telegram não marca', async () => {
        const c = build({ engine: 'baileys' });
        await expect(s.run(c)).rejects.toBeInstanceOf(EngineOperationUnsupportedError);
        expect(c.repo.markConnectRequested).not.toHaveBeenCalled();
      });

      it('falha da engine mantém a marca', async () => {
        const c = build();
        c.engine[s.method].mockRejectedValueOnce(new Error('engine down'));
        await expect(s.run(c)).rejects.toThrow('engine down');
        expect(c.repo.markConnectRequested).toHaveBeenCalledTimes(1);
      });
    });
  }

  it('send-code com telefone inválido não marca', async () => {
    const c = build();
    await expect(c.sendCode.execute({ ...base, userId: 'u1', phone: '12' })).rejects.toBeInstanceOf(SessionPhoneInvalidError);
    expect(c.repo.markConnectRequested).not.toHaveBeenCalled();
    expect(c.engine.requestLoginCode).not.toHaveBeenCalled();
  });

  it('send-code sem telefone declarado não marca', async () => {
    const c = build({ declaredPhone: null });
    await expect(c.sendCode.execute({ ...base, userId: 'u1' })).rejects.toBeInstanceOf(SessionPhoneInvalidError);
    expect(c.repo.markConnectRequested).not.toHaveBeenCalled();
  });

  it('falha ao marcar não chama a engine', async () => {
    const c = build();
    c.repo.markConnectRequested.mockRejectedValueOnce(new Error('db'));
    await expect(c.signIn.execute({ ...base, code: '1' })).rejects.toThrow('db');
    expect(c.engine.submitLoginCode).not.toHaveBeenCalled();
  });
});
