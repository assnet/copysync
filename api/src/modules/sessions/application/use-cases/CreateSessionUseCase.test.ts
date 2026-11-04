import { describe, it, expect, vi } from 'vitest';
import { CreateSessionUseCase } from './CreateSessionUseCase';
import { makeAuditRepo, makeSessionRepo } from './sessionTestFakes';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import { SessionPhoneInvalidError } from '../../../../shared/errors/internal/SessionErrors';

const base = { tenantId: 't1', userId: 'u1', name: 'Ofertas' };

function entitlements(limit: number | null) {
  return { getNumber: vi.fn(async () => limit), getBoolean: vi.fn(async () => null) } as IEntitlementReader & {
    getNumber: ReturnType<typeof vi.fn>;
  };
}

describe('CreateSessionUseCase', () => {
  it('normaliza e persiste o número declarado', async () => {
    const repo = makeSessionRepo();
    const session = await new CreateSessionUseCase(repo, makeAuditRepo(), entitlements(null)).execute({
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
    await new CreateSessionUseCase(repo, makeAuditRepo(), entitlements(null)).execute({ ...base, declaredPhone: '  ' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ declaredPhone: null }));
  });

  it('número inválido → SESSION_PHONE_INVALID sem criar a sessão', async () => {
    const repo = makeSessionRepo();
    const audit = makeAuditRepo();
    const err = await new CreateSessionUseCase(repo, audit, entitlements(null))
      .execute({ ...base, declaredPhone: '12345' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPhoneInvalidError);
    expect(err).toMatchObject({ code: 'SESSION_PHONE_INVALID', statusCode: 422, meta: { field: 'declaredPhone' } });
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
  });

  it('limite de sessões do plano atingido → PLAN_LIMIT_REACHED sem auditar', async () => {
    const repo = makeSessionRepo();
    repo.createWithinLimit.mockRejectedValue(new PlanLimitReachedError('whatsapp_sessions', 1));
    const audit = makeAuditRepo();
    const ent = entitlements(1);
    const err = await new CreateSessionUseCase(repo, audit, ent).execute(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLimitReachedError);
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'whatsapp_sessions', limit: 1 } });
    expect(ent.getNumber).toHaveBeenCalledWith('t1', 'whatsapp_sessions');
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
  });

  it('com limite no plano cria pelo caminho atômico (contagem + criação sob lock)', async () => {
    const repo = makeSessionRepo();
    await new CreateSessionUseCase(repo, makeAuditRepo(), entitlements(2)).execute(base);
    expect(repo.createWithinLimit).toHaveBeenCalledWith(
      { tenantId: 't1', name: 'Ofertas', engine: 'baileys', declaredPhone: null },
      { key: 'whatsapp_sessions', limit: 2, engine: 'baileys' },
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('Telegram: telefone internacional, chave telegram_sessions e engine desligada → ENGINE_DISABLED', async () => {
    const repo = makeSessionRepo();
    const ent = entitlements(1);
    const enabled = new Set(['baileys', 'telegram']);
    await new CreateSessionUseCase(repo, makeAuditRepo(), ent, enabled).execute({
      ...base, engine: 'telegram', declaredPhone: '+1 415 555 0100',
    });
    expect(ent.getNumber).toHaveBeenCalledWith('t1', 'telegram_sessions');
    expect(repo.createWithinLimit).toHaveBeenCalledWith(
      { tenantId: 't1', name: 'Ofertas', engine: 'telegram', declaredPhone: '14155550100' },
      { key: 'telegram_sessions', limit: 1, engine: 'telegram' },
    );
    const err = await new CreateSessionUseCase(repo, makeAuditRepo(), ent).execute({ ...base, engine: 'telegram' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ENGINE_DISABLED', statusCode: 503 });
  });

  it('sem entitlement de sessões é ilimitado e cria direto', async () => {
    const repo = makeSessionRepo();
    await new CreateSessionUseCase(repo, makeAuditRepo(), entitlements(null)).execute(base);
    expect(repo.createWithinLimit).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalled();
  });
});
