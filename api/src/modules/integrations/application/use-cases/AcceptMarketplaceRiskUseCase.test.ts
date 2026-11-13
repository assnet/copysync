import { describe, it, expect, vi } from 'vitest';
import {
  AcceptMarketplaceRiskUseCase,
  type AcceptMarketplaceRiskInput,
  type MarketplaceRiskAcceptTransaction,
} from './AcceptMarketplaceRiskUseCase';
import { ListMarketplaceRiskAcceptancesUseCase } from './ListMarketplaceRiskAcceptancesUseCase';
import { isMarketplaceRiskAccepted, requireMarketplaceRiskAccepted } from '../services/requireMarketplaceRiskAccepted';
import {
  MARKETPLACE_RISK_NOTICE_VERSION,
  OFFER_HUNTER_RISK_NOTICE_VERSION,
  currentRiskNoticeVersion,
  requiresRiskAcceptance,
} from '../../domain/services/marketplaceRiskNotice';
import type {
  CreateMarketplaceRiskAcceptanceRecord,
  IMarketplaceRiskAcceptanceRepository,
} from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { MarketplaceRiskAcceptance } from '../../domain/entities/MarketplaceRiskAcceptance';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { AppError } from '../../../../shared/errors/AppError';

const VERSION = MARKETPLACE_RISK_NOTICE_VERSION.SHEIN!;
const HUNTER_VERSION = OFFER_HUNTER_RISK_NOTICE_VERSION.SHEIN!;
const AT = new Date('2026-11-10T12:00:00.000Z');

/** Fake em memória com a mesma unique do banco (tenant, provider, escopo, versão). */
function makeRepo() {
  const rows: MarketplaceRiskAcceptance[] = [];
  const find = (t: string, p: string, sc: string, v: string) =>
    rows.find((r) => r.tenantId === t && r.provider === p && r.scope === sc && r.noticeVersion === v) ?? null;
  const repo = {
    findCurrent: vi.fn(async (t: string, p: MarketplaceRiskAcceptance['provider'], sc: MarketplaceRiskAcceptance['scope'], v: string) => find(t, p, sc, v)),
    create: vi.fn(async (i: CreateMarketplaceRiskAcceptanceRecord) => {
      const existing = find(i.tenantId, i.provider, i.scope, i.noticeVersion);
      if (existing) return { acceptance: existing, created: false };
      const row = { id: `a${rows.length + 1}`, acceptedAt: AT, ...i };
      rows.push(row);
      return { acceptance: row, created: true };
    }),
    listByTenant: vi.fn(async (t: string) => rows.filter((r) => r.tenantId === t)),
  } satisfies IMarketplaceRiskAcceptanceRepository;
  return { repo, rows };
}

/** Transação falsa: erro dentro de `fn` desfaz as linhas gravadas nela. */
function makeSut() {
  const { repo, rows } = makeRepo();
  const audit = { create: vi.fn().mockResolvedValue(undefined) } satisfies IAuditLogRepository;
  const transaction: MarketplaceRiskAcceptTransaction = async (fn) => {
    const snapshot = rows.length;
    try {
      return await fn({ acceptances: repo, audit });
    } catch (err) {
      rows.splice(snapshot);
      throw err;
    }
  };
  return { sut: new AcceptMarketplaceRiskUseCase(transaction), repo, rows, audit };
}

const input = (over: Partial<AcceptMarketplaceRiskInput> = {}): AcceptMarketplaceRiskInput => ({
  tenantId: 't1', userId: 'u1', role: 'ADMIN', isSuperAdmin: false,
  provider: 'SHEIN', noticeVersion: VERSION, locale: 'pt-BR', ...over,
});

const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: AppError) => e);

describe('marketplaceRiskNotice', () => {
  it('só SHEIN exige aceite', () => {
    expect(requiresRiskAcceptance('SHEIN')).toBe(true);
    expect(currentRiskNoticeVersion('SHEIN')).toBe('2026-11-10');
    for (const p of ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON'] as const) {
      expect(requiresRiskAcceptance(p)).toBe(false);
      expect(currentRiskNoticeVersion(p)).toBeNull();
    }
  });

  it('versão por provider e escopo: caçador só SHEIN, com versão própria', () => {
    expect(currentRiskNoticeVersion('SHEIN', 'AFFILIATE_LINK')).toBe('2026-11-10');
    expect(currentRiskNoticeVersion('SHEIN', 'OFFER_HUNTER')).toBe('2026-11-12');
    expect(requiresRiskAcceptance('SHEIN', 'OFFER_HUNTER')).toBe(true);
    for (const p of ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON'] as const) {
      expect(currentRiskNoticeVersion(p, 'OFFER_HUNTER')).toBeNull();
    }
  });
});

describe('AcceptMarketplaceRiskUseCase', () => {
  it('grava tenant, usuário, versão e idioma; devolve hora e versão; audita', async () => {
    const { sut, rows, audit } = makeSut();
    expect(await sut.execute(input())).toEqual({ acceptedAt: AT, noticeVersion: VERSION, scope: 'AFFILIATE_LINK' });
    expect(rows).toEqual([expect.objectContaining({ tenantId: 't1', acceptedByUserId: 'u1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, locale: 'pt-BR', acceptedAt: AT })]);
    expect(audit.create).toHaveBeenCalledWith({
      tenantId: 't1', userId: 'u1', action: 'MARKETPLACE_RISK_ACCEPTED',
      meta: { provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, locale: 'pt-BR' },
    });
  });

  it('escopo OFFER_HUNTER grava com a versão do caçador e não vale como aceite do link', async () => {
    const { sut, rows, repo, audit } = makeSut();
    expect(await sut.execute(input({ scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION })))
      .toEqual({ acceptedAt: AT, noticeVersion: HUNTER_VERSION, scope: 'OFFER_HUNTER' });
    expect(rows).toEqual([expect.objectContaining({ scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION })]);
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { provider: 'SHEIN', scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION, locale: 'pt-BR' },
    }));
    expect(await isMarketplaceRiskAccepted(repo, 't1', 'SHEIN', 'OFFER_HUNTER')).toBe(true);
    expect(await isMarketplaceRiskAccepted(repo, 't1', 'SHEIN')).toBe(false);
  });

  it('mesmo tenant aceita os dois escopos: linhas distintas, cada uma auditada', async () => {
    const { sut, rows, audit } = makeSut();
    await sut.execute(input());
    await sut.execute(input({ scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION }));
    expect(rows.map((r) => r.scope)).toEqual(['AFFILIATE_LINK', 'OFFER_HUNTER']);
    expect(audit.create).toHaveBeenCalledTimes(2);
  });

  it('OFFER_HUNTER com a versão do aviso do link → 409 com a versão do caçador', async () => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ scope: 'OFFER_HUNTER' })))).toMatchObject({
      statusCode: 409, code: 'MARKETPLACE_RISK_NOTICE_OUTDATED',
      meta: { provider: 'SHEIN', currentVersion: HUNTER_VERSION, scope: 'OFFER_HUNTER' },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('OFFER_HUNTER para provider que não é SHEIN → 422 no campo scope', async () => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ provider: 'SHOPEE', scope: 'OFFER_HUNTER' }))))
      .toMatchObject({ statusCode: 422, code: 'AFFILIATE_CREDENTIAL_INVALID', meta: { field: 'scope' } });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['com papel SUPER_ADMIN', { role: 'SUPER_ADMIN' }],
    ['com papel ADMIN', {}],
  ])('super admin %s aceita o escopo do caçador e a auditoria marca bySuperAdmin', async (_n, over) => {
    const { sut, rows, audit } = makeSut();
    expect(await sut.execute(input({ ...over, isSuperAdmin: true, userId: 'sa1', scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION })))
      .toMatchObject({ noticeVersion: HUNTER_VERSION, scope: 'OFFER_HUNTER' });
    expect(rows[0]).toMatchObject({ acceptedByUserId: 'sa1', scope: 'OFFER_HUNTER' });
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'sa1', meta: expect.objectContaining({ bySuperAdmin: true }) }));
  });

  it('operador continua sem aceitar o escopo do caçador', async () => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ role: 'OPERATOR', scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION }))))
      .toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('repetido na mesma versão devolve o existente e não audita de novo', async () => {
    const { sut, rows, audit } = makeSut();
    await sut.execute(input());
    expect(await sut.execute(input({ userId: 'u2', locale: 'en' }))).toEqual({ acceptedAt: AT, noticeVersion: VERSION, scope: 'AFFILIATE_LINK' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ acceptedByUserId: 'u1', locale: 'pt-BR' });
    expect(audit.create).toHaveBeenCalledTimes(1);
  });

  it('auditoria falha → erro propagado e nada fica gravado; retry grava e audita', async () => {
    const { sut, rows, audit } = makeSut();
    audit.create.mockRejectedValueOnce(new Error('audit down'));
    await expect(sut.execute(input())).rejects.toThrow('audit down');
    expect(rows).toHaveLength(0);
    expect(await sut.execute(input())).toEqual({ acceptedAt: AT, noticeVersion: VERSION, scope: 'AFFILIATE_LINK' });
    expect(rows).toHaveLength(1);
    expect(audit.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['operador', { role: 'OPERATOR' }],
    ['super admin', { role: 'SUPER_ADMIN', isSuperAdmin: true }],
    ['super admin com papel ADMIN', { isSuperAdmin: true }],
  ])('%s → 403 sem gravar', async (_n, over) => {
    const { sut, repo, audit } = makeSut();
    expect(await errorOf(sut.execute(input(over)))).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
  });

  it('versão antiga → 409 com a vigente', async () => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ noticeVersion: '2026-01-01' })))).toMatchObject({
      statusCode: 409, code: 'MARKETPLACE_RISK_NOTICE_OUTDATED', meta: { provider: 'SHEIN', currentVersion: VERSION },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('provider sem aviso → 422', async () => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ provider: 'SHOPEE' })))).toMatchObject({ statusCode: 422, code: 'AFFILIATE_CREDENTIAL_INVALID' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each(['pt_BR', 'portuguese', '', 'PT-br'])('locale inválido %j → 422', async (locale) => {
    const { sut, repo } = makeSut();
    expect(await errorOf(sut.execute(input({ locale })))).toMatchObject({ statusCode: 422, meta: { field: 'locale' } });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('aceite de um tenant não vale para outro', async () => {
    const { sut, repo } = makeSut();
    await sut.execute(input());
    expect(await isMarketplaceRiskAccepted(repo, 't1', 'SHEIN')).toBe(true);
    expect(await isMarketplaceRiskAccepted(repo, 't2', 'SHEIN')).toBe(false);
    expect(await new ListMarketplaceRiskAcceptancesUseCase(repo).execute('t2')).toEqual([]);
    expect(await new ListMarketplaceRiskAcceptancesUseCase(repo).execute('t1')).toHaveLength(1);
  });
});

describe('requireMarketplaceRiskAccepted', () => {
  it('sem aceite da versão vigente → 403; com aceite passa', async () => {
    const { repo, rows } = makeRepo();
    rows.push({ id: 'old', tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: '2025-01-01', acceptedByUserId: 'u1', locale: 'pt-BR', acceptedAt: AT });
    expect(await errorOf(requireMarketplaceRiskAccepted(repo, 't1', 'SHEIN'))).toMatchObject({
      statusCode: 403, code: 'MARKETPLACE_RISK_NOT_ACCEPTED', meta: { provider: 'SHEIN', noticeVersion: VERSION },
    });
    expect(await isMarketplaceRiskAccepted(repo, 't1', 'SHEIN')).toBe(false);
    await repo.create({ tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR' });
    await expect(requireMarketplaceRiskAccepted(repo, 't1', 'SHEIN')).resolves.toBeUndefined();
  });

  it('escopo OFFER_HUNTER cobra só o aceite do caçador', async () => {
    const { repo } = makeRepo();
    await repo.create({ tenantId: 't1', provider: 'SHEIN', scope: 'AFFILIATE_LINK', noticeVersion: VERSION, acceptedByUserId: 'u1', locale: 'pt-BR' });
    expect(await errorOf(requireMarketplaceRiskAccepted(repo, 't1', 'SHEIN', 'OFFER_HUNTER'))).toMatchObject({
      statusCode: 403, code: 'MARKETPLACE_RISK_NOT_ACCEPTED', meta: { provider: 'SHEIN', noticeVersion: HUNTER_VERSION, scope: 'OFFER_HUNTER' },
    });
    await repo.create({ tenantId: 't1', provider: 'SHEIN', scope: 'OFFER_HUNTER', noticeVersion: HUNTER_VERSION, acceptedByUserId: 'u1', locale: 'pt-BR' });
    await expect(requireMarketplaceRiskAccepted(repo, 't1', 'SHEIN', 'OFFER_HUNTER')).resolves.toBeUndefined();
    expect(repo.findCurrent).toHaveBeenLastCalledWith('t1', 'SHEIN', 'OFFER_HUNTER', HUNTER_VERSION);
  });

  it('provider sem aviso passa sem consultar o repositório', async () => {
    const { repo } = makeRepo();
    for (const p of ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON'] as const) {
      await expect(requireMarketplaceRiskAccepted(repo, 't1', p)).resolves.toBeUndefined();
      expect(await isMarketplaceRiskAccepted(repo, 't1', p)).toBe(true);
    }
    expect(repo.findCurrent).not.toHaveBeenCalled();
  });
});
