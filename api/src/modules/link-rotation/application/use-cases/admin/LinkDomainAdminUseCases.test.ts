import { beforeEach, describe, expect, it } from 'vitest';
import { CreateLinkDomainUseCase } from './CreateLinkDomainUseCase';
import { DeleteLinkDomainUseCase } from './DeleteLinkDomainUseCase';
import { ListLinkDomainsUseCase } from './ListLinkDomainsUseCase';
import { UpdateLinkDomainUseCase } from './UpdateLinkDomainUseCase';
import { FakeLinkDomainRepository } from './linkDomainTestFakes';
import { PLATFORM_HOSTNAMES } from './linkDomainRules';

let repo: FakeLinkDomainRepository;
beforeEach(() => { repo = new FakeLinkDomainRepository(); });

describe('CreateLinkDomainUseCase', () => {
  const create = () => new CreateLinkDomainUseCase(repo, PLATFORM_HOSTNAMES);

  it('normaliza hostname e reservados; landingUrl opcional', async () => {
    const d = await create().execute({ hostname: 'HTTPS://CopySync.com.br./', reservedNames: ['Loja '] });
    expect(d).toMatchObject({ hostname: 'copysync.com.br', landingUrl: null, reservedNames: ['loja'] });
  });

  it.each(['localhost', 'a_b.com', 'http://-x.com'])('recusa hostname inválido %s', async (hostname) => {
    await expect(create().execute({ hostname })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID', statusCode: 400 });
  });

  it('recusa hosts da plataforma', async () => {
    for (const hostname of ['app.copysync.app', 'API.copysync.app', 'x.api.copysync.app'])
      await expect(create().execute({ hostname })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
  });

  it('recusa landingUrl inválida', async () => {
    await expect(create().execute({ hostname: 'copysync.com.br', landingUrl: 'http://copysync.app' }))
      .rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
  });

  it('nomes especiais: mesma normalização e limite dos reservados', async () => {
    const d = await create().execute({ hostname: 'copysync.com.br', premiumNames: [' Ofertas ', 'ofertas', 'Black Friday'] });
    expect(d.premiumNames).toEqual(['ofertas', 'black-friday']);
    await expect(create().execute({ hostname: 'x.com.br', premiumNames: ['a!b'] })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
    await expect(create().execute({ hostname: 'y.com.br', premiumNames: Array.from({ length: 1001 }, (_, i) => `n${i}`) }))
      .rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
  });

  it('hostname repetido → 409', async () => {
    repo.seed({ hostname: 'copysync.com.br' });
    await expect(create().execute({ hostname: 'copysync.com.br' })).rejects.toMatchObject({ code: 'LINK_DOMAIN_TAKEN', statusCode: 409 });
  });
});

describe('UpdateLinkDomainUseCase', () => {
  it('cadastra e remove landingUrl depois', async () => {
    const { id } = repo.seed({ hostname: 'copysync.com.br' });
    const uc = new UpdateLinkDomainUseCase(repo);
    expect((await uc.execute({ id, landingUrl: 'https://copysync.app' })).landingUrl).toBe('https://copysync.app/');
    expect((await uc.execute({ id, landingUrl: null })).landingUrl).toBeNull();
    await expect(uc.execute({ id, landingUrl: 'ftp://x.com' })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
    await expect(uc.execute({ id: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('troca nomes especiais; ausente mantém', async () => {
    const { id } = repo.seed({ hostname: 'copysync.com.br', premiumNames: ['vip'] });
    const uc = new UpdateLinkDomainUseCase(repo);
    expect((await uc.execute({ id, landingUrl: null })).premiumNames).toEqual(['vip']);
    expect((await uc.execute({ id, premiumNames: ['Loja Top'] })).premiumNames).toEqual(['loja-top']);
    await expect(uc.execute({ id, premiumNames: ['-'.repeat(2) + '!'] })).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
  });
});

describe('DeleteLinkDomainUseCase', () => {
  it('com rotação → 409 e não exclui', async () => {
    const { id } = repo.seed({ hostname: 'copysync.com.br' });
    repo.rotations.set(id, 1);
    await expect(new DeleteLinkDomainUseCase(repo).execute(id)).rejects.toMatchObject({ code: 'LINK_DOMAIN_IN_USE', statusCode: 409 });
    expect(repo.rows.has(id)).toBe(true);
  });

  it('com claim de nome ou grant premium → 409 e não exclui', async () => {
    const { id } = repo.seed({ hostname: 'copysync.com.br' });
    repo.slugUsage.set(id, 1);
    await expect(new DeleteLinkDomainUseCase(repo).execute(id)).rejects.toMatchObject({ code: 'LINK_DOMAIN_IN_USE', statusCode: 409 });
    expect(repo.rows.has(id)).toBe(true);
  });

  it('sem rotação exclui; inexistente → 404', async () => {
    const { id } = repo.seed({ hostname: 'copysync.com.br' });
    await new DeleteLinkDomainUseCase(repo).execute(id);
    expect(await new ListLinkDomainsUseCase(repo).execute()).toEqual([]);
    await expect(new DeleteLinkDomainUseCase(repo).execute(id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
