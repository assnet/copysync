import { describe, expect, it, vi } from 'vitest';
import { DeleteStorefrontUseCase, type DeleteStorefrontDTO } from './DeleteStorefrontUseCase';
import { MEDIA_URL, makeStorefrontDeps, OTHER_TENANT, seedPageWithClaim, STOREFRONT_DOMAIN, TENANT, USER } from './storefrontTestFakes';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PublicSlugKind } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import { StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { logger } from '../../../../shared/logger/logger';

const PASSWORD = 'senha-certa';
const img = (n: number) => `${MEDIA_URL}${n}.webp`;

function setup() {
  const { deps, fakes } = makeStorefrontDeps();
  const page = seedPageWithClaim(fakes, { avatarUrl: img(1), coverUrl: img(2) });
  fakes.offers.seed({ imageUrl: img(3) });
  fakes.offers.seed({ imageUrl: null });
  fakes.offers.seed({ imageUrl: img(4) });
  const uc = new DeleteStorefrontUseCase(deps);
  const run = (over: Partial<DeleteStorefrontDTO> = {}) =>
    uc.execute({ tenantId: TENANT, userId: USER, role: 'ADMIN', isSuperAdmin: false, password: PASSWORD, ...over });
  return { fakes, page, run };
}

describe('DeleteStorefrontUseCase', () => {
  it('admin com a senha certa: página e claim somem, auditoria gravada e imagens removidas depois', async () => {
    const { fakes, run } = setup();
    await run();
    expect(fakes.storefronts.pages).toHaveLength(0);
    expect(fakes.slugs.storefronts).toHaveLength(0);
    expect(fakes.rotations.reservations).toHaveLength(0);
    expect(fakes.audit.entries).toEqual([{
      tenantId: TENANT, userId: USER, action: 'STOREFRONT_DELETED',
      // `images`: só a contagem do que o pós-commit deve remover (nunca nome de arquivo)
      meta: { slug: 'minhaloja', domainId: STOREFRONT_DOMAIN, offers: 3, images: 4, bySuperAdmin: false },
    }]);
    expect(JSON.stringify(fakes.audit.entries)).not.toContain('.webp');
    expect([...fakes.media.removed].sort()).toEqual([img(1), img(2), img(3), img(4)]);
    expect(fakes.confirmPassword.calls).toEqual([{ userId: USER, action: 'STOREFRONT_DELETE' }]);
  });

  it('trava a página (FOR UPDATE) antes de ler e listar o que será apagado', async () => {
    const { fakes, run } = setup();
    const { calls } = fakes.storefronts;
    const find = fakes.storefronts.findByTenant.bind(fakes.storefronts);
    vi.spyOn(fakes.storefronts, 'findByTenant').mockImplementation((t) => { calls.push('find'); return find(t); });
    const list = fakes.offers.listByStorefront.bind(fakes.offers);
    vi.spyOn(fakes.offers, 'listByStorefront').mockImplementation((t, id) => { calls.push('list'); return list(t, id); });
    await run();
    // 1º find = checagem antes da senha (fora do tx); dentro do tx a trava vem primeiro
    expect(calls).toEqual(['find', 'lock', 'find', 'list', 'delete']);
  });

  it('remoção sem falha: log estruturado com a contagem e failed 0', async () => {
    const { run } = setup();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await run();
    expect(info).toHaveBeenCalledWith({ tenantId: TENANT, images: 4, failed: 0 }, expect.any(String));
  });

  it('endereço fica livre na hora para outro tenant (sem reserva de 30 dias)', async () => {
    const { fakes, run } = setup();
    await run();
    expect((await fakes.slugs.check(OTHER_TENANT, STOREFRONT_DOMAIN, 'minhaloja')).status).toBe('AVAILABLE');
    await expect(fakes.slugs.claim({
      tenantId: OTHER_TENANT, domainId: STOREFRONT_DOMAIN, slug: 'minhaloja', kind: PublicSlugKind.STOREFRONT, ownerId: 'sf-outro',
    })).resolves.toBeUndefined();
  });

  it('nome premium liberado continua exigindo grant do próximo dono', async () => {
    const { fakes, run } = setup();
    fakes.domains.items[0]!.premiumNames = ['minhaloja'];
    await run();
    await expect(fakes.slugs.claim({
      tenantId: OTHER_TENANT, domainId: STOREFRONT_DOMAIN, slug: 'minhaloja', kind: PublicSlugKind.STOREFRONT, ownerId: 'sf-outro',
    })).rejects.toMatchObject({ code: 'LINK_SLUG_RESERVED' });
  });

  it('operador: 403 antes de qualquer leitura, senha ou escrita', async () => {
    const { fakes, run } = setup();
    const find = vi.spyOn(fakes.storefronts, 'findByTenant');
    await expect(run({ role: 'OPERATOR' })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(find).not.toHaveBeenCalled();
    expect(fakes.confirmPassword.calls).toHaveLength(0);
    expect(fakes.storefronts.pages).toHaveLength(1);
  });

  it('super admin exclui com a própria senha e a auditoria marca bySuperAdmin', async () => {
    const { fakes, run } = setup();
    await run({ userId: 'root-1', role: 'SUPER_ADMIN', isSuperAdmin: true });
    expect(fakes.confirmPassword.calls).toEqual([{ userId: 'root-1', action: 'STOREFRONT_DELETE' }]);
    expect(fakes.audit.entries[0]).toMatchObject({ userId: 'root-1', meta: { bySuperAdmin: true } });
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('sem página: 404 STOREFRONT_NOT_FOUND antes de conferir a senha', async () => {
    const { fakes, run } = setup();
    await expect(run({ tenantId: OTHER_TENANT })).rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND', statusCode: 404 });
    expect(fakes.confirmPassword.calls).toHaveLength(0);
  });

  it('senha errada: 401 e nada é apagado', async () => {
    const { fakes, run } = setup();
    await expect(run({ password: 'errada' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(fakes.storefronts.pages).toHaveLength(1);
    expect(fakes.slugs.storefronts).toHaveLength(1);
    expect(fakes.audit.entries).toHaveLength(0);
    expect(fakes.media.removed).toHaveLength(0);
    expect(fakes.storefronts.txCalls).toBe(0);
  });

  it('auditoria falha: transação desfeita, página e claim continuam e nenhuma imagem é removida', async () => {
    const { fakes, run } = setup();
    fakes.audit.error = new Error('audit down');
    await expect(run()).rejects.toThrow('audit down');
    expect(fakes.storefronts.pages).toHaveLength(1);
    expect(fakes.slugs.storefronts).toHaveLength(1);
    expect(fakes.media.removed).toHaveLength(0);
  });

  it('não exige o plano: página pausada pelo plano e storefront_enabled=false ainda é excluída', async () => {
    const { fakes, run } = setup();
    fakes.entitlements.values[ENTITLEMENT_KEYS.STOREFRONT_ENABLED] = false;
    fakes.storefronts.pages[0]!.status = StorefrontStatus.PAUSED_BY_PLAN;
    await run();
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('página sem endereço nem imagens: exclui e audita slug null', async () => {
    const { deps, fakes } = makeStorefrontDeps();
    fakes.storefronts.seed({ address: null });
    await new DeleteStorefrontUseCase(deps).execute({ tenantId: TENANT, userId: USER, role: 'ADMIN', isSuperAdmin: false, password: PASSWORD });
    expect(fakes.audit.entries[0]!.meta).toEqual({ slug: null, domainId: null, offers: 0, images: 0, bySuperAdmin: false });
    expect(fakes.media.removed).toHaveLength(0);
  });

  it('falha ao remover imagem não desfaz a exclusão; log só com contagem (sem senha nem nome de arquivo)', async () => {
    const { fakes, run } = setup();
    fakes.media.failing.add(img(3));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await expect(run()).resolves.toBeUndefined();
    expect(fakes.storefronts.pages).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith({ tenantId: TENANT, images: 4, failed: 1 }, expect.any(String));
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('.webp');
    expect(JSON.stringify(fakes.audit.entries)).not.toContain(PASSWORD);
  });
});
