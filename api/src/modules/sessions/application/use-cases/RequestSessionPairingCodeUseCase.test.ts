import { describe, it, expect } from 'vitest';
import { RequestSessionPairingCodeUseCase } from './RequestSessionPairingCodeUseCase';
import { makeAuditRepo, makeEngine, makeSession, makeSessionRepo } from './sessionTestFakes';
import {
  SessionAlreadyConnectedError,
  SessionNotFoundError,
  SessionPhoneInvalidError,
} from '../../../../shared/errors/internal/SessionErrors';

const input = { sessionId: 's1', tenantId: 't1', userId: 'u1' };

function build(session = makeSession({ declaredPhone: '5511987654321' }), code: string | null = null) {
  const repo = makeSessionRepo(session);
  const engine = makeEngine(code);
  return { repo, engine, uc: new RequestSessionPairingCodeUseCase(repo, makeAuditRepo(), engine) };
}

describe('RequestSessionPairingCodeUseCase', () => {
  it('usa o número declarado e marca CONNECTING quando ainda não há socket', async () => {
    const { repo, engine, uc } = build();
    const out = await uc.execute(input);
    expect(repo.updateStatus).toHaveBeenCalledWith('s1', 't1', { status: 'CONNECTING' });
    expect(engine.requestPairingCode).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1', phone: '5511987654321' });
    expect(out).toEqual({ sessionId: 's1', status: 'CONNECTING', pairingCode: null });
  });

  it('número do corpo tem prioridade e é normalizado', async () => {
    const { engine, uc } = build();
    await uc.execute({ ...input, phone: '21 99999-8888' });
    expect(engine.requestPairingCode).toHaveBeenCalledWith(expect.objectContaining({ phone: '5521999998888' }));
  });

  it('código imediato → AWAITING_PAIRING, sem regravar status de socket já ativo', async () => {
    const { repo, uc } = build(makeSession({ declaredPhone: '5511987654321', status: 'AWAITING_QR' }), 'ABCD1234');
    const out = await uc.execute(input);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(out).toEqual({ sessionId: 's1', status: 'AWAITING_PAIRING', pairingCode: 'ABCD1234' });
  });

  it('sem número → SESSION_PHONE_INVALID (declaredPhone)', async () => {
    const { engine, uc } = build(makeSession());
    await expect(uc.execute(input)).rejects.toMatchObject({ code: 'SESSION_PHONE_INVALID', meta: { field: 'declaredPhone' } });
    expect(engine.requestPairingCode).not.toHaveBeenCalled();
  });

  it('número do corpo inválido → SESSION_PHONE_INVALID (phone)', async () => {
    const { uc } = build();
    const err = await uc.execute({ ...input, phone: '999' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPhoneInvalidError);
    expect(err).toMatchObject({ meta: { field: 'phone' } });
  });

  it('sessão conectada → SESSION_ALREADY_CONNECTED', async () => {
    const { uc } = build(makeSession({ declaredPhone: '5511987654321', status: 'CONNECTED' }));
    await expect(uc.execute(input)).rejects.toBeInstanceOf(SessionAlreadyConnectedError);
  });

  it('sessão inexistente → SESSION_NOT_FOUND', async () => {
    const repo = makeSessionRepo(null);
    const uc = new RequestSessionPairingCodeUseCase(repo, makeAuditRepo(), makeEngine());
    await expect(uc.execute(input)).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('motor falhando → restaura o status anterior e repassa o erro', async () => {
    const { repo, engine, uc } = build(makeSession({ declaredPhone: '5511987654321', status: 'LOGGED_OUT' }));
    const boom = new Error('engine down');
    engine.requestPairingCode.mockRejectedValueOnce(boom);
    await expect(uc.execute(input)).rejects.toBe(boom);
    expect(repo.updateStatus).toHaveBeenNthCalledWith(1, 's1', 't1', { status: 'CONNECTING' });
    expect(repo.updateStatus).toHaveBeenLastCalledWith('s1', 't1', { status: 'LOGGED_OUT' });
  });

  it('motor falhando com socket ativo → não mexe no status', async () => {
    const { repo, engine, uc } = build(makeSession({ declaredPhone: '5511987654321', status: 'AWAITING_QR' }));
    engine.requestPairingCode.mockRejectedValueOnce(new Error('x'));
    await expect(uc.execute(input)).rejects.toThrow('x');
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});
