import { describe, it, expect } from 'vitest';
import { CreateSessionUseCase } from './CreateSessionUseCase';
import { makeAuditRepo, makeSessionRepo } from './sessionTestFakes';
import { SessionPhoneInvalidError } from '../../../../shared/errors/internal/SessionErrors';

const base = { tenantId: 't1', userId: 'u1', name: 'Ofertas' };

describe('CreateSessionUseCase', () => {
  it('normaliza e persiste o número declarado', async () => {
    const repo = makeSessionRepo();
    const session = await new CreateSessionUseCase(repo, makeAuditRepo()).execute({
      ...base,
      declaredPhone: '(11) 98765-4321',
    });
    expect(repo.create).toHaveBeenCalledWith({
      tenantId: 't1', name: 'Ofertas', engine: 'baileys', declaredPhone: '5511987654321',
    });
    expect(session.declaredPhone).toBe('5511987654321');
  });

  it('sem número declarado grava null', async () => {
    const repo = makeSessionRepo();
    await new CreateSessionUseCase(repo, makeAuditRepo()).execute({ ...base, declaredPhone: '  ' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ declaredPhone: null }));
  });

  it('número inválido → SESSION_PHONE_INVALID sem criar a sessão', async () => {
    const repo = makeSessionRepo();
    const audit = makeAuditRepo();
    const err = await new CreateSessionUseCase(repo, audit)
      .execute({ ...base, declaredPhone: '12345' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPhoneInvalidError);
    expect(err).toMatchObject({ code: 'SESSION_PHONE_INVALID', statusCode: 422, meta: { field: 'declaredPhone' } });
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
  });
});
