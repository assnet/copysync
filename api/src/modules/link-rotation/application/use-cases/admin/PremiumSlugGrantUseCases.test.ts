import { beforeEach, describe, expect, it } from 'vitest';
import { GrantPremiumSlugUseCase } from './GrantPremiumSlugUseCase';
import { ListPremiumSlugGrantsUseCase } from './ListPremiumSlugGrantsUseCase';
import { RevokePremiumSlugUseCase } from './RevokePremiumSlugUseCase';
import { FakeAuditLog, FakeLinkDomainRepository, FakePremiumSlugGrantRepository } from './linkDomainTestFakes';

const NOW = new Date('2026-10-29T12:00:00.000Z');
let domains: FakeLinkDomainRepository;
let grants: FakePremiumSlugGrantRepository;
let audit: FakeAuditLog;
let domainId: string;
beforeEach(() => {
  domains = new FakeLinkDomainRepository();
  grants = new FakePremiumSlugGrantRepository();
  audit = new FakeAuditLog();
  domainId = domains.seed({ hostname: 'copysync.com.br', premiumNames: ['ofertas', 'vip'] }).id;
});

const grant = (over: Record<string, unknown> = {}) =>
  new GrantPremiumSlugUseCase(domains, grants, audit, () => NOW)
    .execute({ domainId, tenantId: 'tenant-1', slug: 'Ofertas', actorUserId: 'admin-1', ...over });

describe('GrantPremiumSlugUseCase', () => {
  it('grava MANUAL com slug normalizado e AuditLog PREMIUM_SLUG_GRANTED', async () => {
    const g = await grant({ expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(g).toMatchObject({ domainId, slug: 'ofertas', tenantId: 'tenant-1', source: 'MANUAL', expiresAt: new Date('2027-01-01T00:00:00.000Z') });
    expect(audit.entries).toEqual([{
      tenantId: 'tenant-1', userId: 'admin-1', action: 'PREMIUM_SLUG_GRANTED',
      meta: { grantId: g.id, domainId, hostname: 'copysync.com.br', slug: 'ofertas', source: 'MANUAL', expiresAt: '2027-01-01T00:00:00.000Z' },
    }]);
  });

  it('sem validade grava null', async () => {
    expect((await grant({ expiresAt: null })).expiresAt).toBeNull();
  });

  it('nome fora de premiumNames ou validade no passado → LINK_DOMAIN_INVALID, sem audit', async () => {
    await expect(grant({ slug: 'promo' })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID', statusCode: 400 });
    await expect(grant({ expiresAt: '2026-10-29T11:59:59.000Z' })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
    await expect(grant({ expiresAt: 'amanhã' })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
    expect(audit.entries).toEqual([]);
  });

  it('nome já concedido → 409; domínio ou tenant inexistente → 404', async () => {
    await grant();
    await expect(grant({ tenantId: 'tenant-2' })).rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN', statusCode: 409 });
    await expect(grant({ domainId: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(grant({ slug: 'vip', tenantId: 'ghost' })).rejects.toMatchObject({ statusCode: 404 });
    expect(audit.entries).toHaveLength(1);
  });
});

describe('RevokePremiumSlugUseCase / ListPremiumSlugGrantsUseCase', () => {
  it('lista do domínio, revoga com AuditLog PREMIUM_SLUG_REVOKED', async () => {
    const g = await grant();
    expect(await new ListPremiumSlugGrantsUseCase(domains, grants).execute(domainId)).toEqual([g]);
    await new RevokePremiumSlugUseCase(grants, audit).execute({ domainId, grantId: g.id, actorUserId: 'admin-1' });
    expect(grants.rows).toEqual([]);
    expect(audit.entries[1]).toEqual({
      tenantId: 'tenant-1', userId: 'admin-1', action: 'PREMIUM_SLUG_REVOKED',
      meta: { grantId: g.id, domainId, slug: 'ofertas', source: 'MANUAL' },
    });
  });

  it('grant de outro domínio ou inexistente → 404; listar domínio inexistente → 404', async () => {
    const g = await grant();
    const other = domains.seed({ hostname: 'outro.com.br' }).id;
    await expect(new RevokePremiumSlugUseCase(grants, audit).execute({ domainId: other, grantId: g.id, actorUserId: 'a' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(grants.rows).toHaveLength(1);
    await expect(new ListPremiumSlugGrantsUseCase(domains, grants).execute('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
