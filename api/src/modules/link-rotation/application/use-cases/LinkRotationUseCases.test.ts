import { beforeEach, describe, expect, it } from 'vitest';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { LinkDomainStatus, LinkRotationGroupLinkSource, LinkRotationStatus } from '../../domain/enums/LinkRotationEnums';
import { GroupInviteNotAllowedError } from '../../../../shared/errors/internal/GroupErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { CreateLinkRotationUseCase } from './CreateLinkRotationUseCase';
import { DeleteLinkRotationUseCase } from './DeleteLinkRotationUseCase';
import { GetLinkRotationOverviewUseCase } from './GetLinkRotationOverviewUseCase';
import { RefreshLinkRotationGroupUseCase } from './RefreshLinkRotationGroupUseCase';
import { RenameLinkRotationUseCase } from './RenameLinkRotationUseCase';
import { SaveLinkRotationGroupsUseCase } from './SaveLinkRotationGroupsUseCase';
import { UpdateLinkRotationUseCase } from './UpdateLinkRotationUseCase';
import { CODE, makeDeps, makeDomain, NOW, OTHER_SESSION, OTHER_TENANT, SESSION, TENANT } from './linkRotationTestFakes';

const DAY = 86_400_000;
let deps: ReturnType<typeof makeDeps>;
beforeEach(() => { deps = makeDeps(); });

const create = (over: Record<string, unknown> = {}) =>
  new CreateLinkRotationUseCase(deps).execute({ tenantId: TENANT, sessionId: SESSION, domainId: 'dom-1', slug: 'promodemae', ...over });

describe('CreateLinkRotationUseCase', () => {
  it('cria com slug normalizado, BALANCED e link público', async () => {
    const out = await create({ slug: ' Promo De Mãe ', title: '  ' });
    expect(out).toMatchObject({ slug: 'promo-de-mae', strategy: 'BALANCED', title: null, publicUrl: 'https://promo-de-mae.copysync.com.br', groups: [] });
  });

  it('limite link_rotations atingido → PLAN_LIMIT_REACHED', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATIONS] = 1;
    deps.rotations.seed();
    await expect(create()).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotations', limit: 1 } });
  });

  it('null = ilimitado', async () => {
    deps.rotations.seed(); deps.rotations.seed();
    await expect(create()).resolves.toMatchObject({ slug: 'promodemae' });
  });

  it('sessão de outro tenant → SESSION_NOT_FOUND', async () => {
    await expect(create({ sessionId: 'session-x' })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('domínio pausado → LINK_DOMAIN_INVALID', async () => {
    deps.domains.items = [makeDomain({ status: LinkDomainStatus.PAUSED })];
    await expect(create()).rejects.toMatchObject({ code: 'LINK_DOMAIN_INVALID' });
  });

  it('slug inválido e reservado (padrão e do domínio)', async () => {
    await expect(create({ slug: 'ab' })).rejects.toMatchObject({ code: 'LINK_SLUG_INVALID' });
    await expect(create({ slug: 'admin' })).rejects.toMatchObject({ code: 'LINK_SLUG_RESERVED' });
    deps.domains.items = [makeDomain({ reservedNames: ['promo'] })];
    await expect(create({ slug: 'promo' })).rejects.toMatchObject({ code: 'LINK_SLUG_RESERVED' });
  });

  it('slug tomado → LINK_SLUG_TAKEN com sugestões livres', async () => {
    deps.rotations.seed({ tenantId: OTHER_TENANT, slug: 'promodemae' });
    deps.rotations.seed({ tenantId: OTHER_TENANT, slug: 'promodemae-oficial' });
    const err = await create().catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_TAKEN');
    expect(err.meta.suggestions).toEqual(['promodemae-vip', 'promodemae2', 'promodemae3', 'promodemae4', 'promodemae5']);
  });

  it('slug reservado (30 d) para outro tenant → TAKEN; o próprio tenant reusa', async () => {
    await deps.rotations.reserveSlug('dom-1', 'promodemae', OTHER_TENANT, new Date(NOW.getTime() + DAY));
    await expect(create()).rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN' });
    await deps.rotations.reserveSlug('dom-1', 'promodemae', TENANT, new Date(NOW.getTime() + DAY));
    await expect(create()).resolves.toMatchObject({ slug: 'promodemae' });
  });

  it('corrida no unique do repositório → TAKEN com sugestões', async () => {
    deps.rotations.raceOnce = true;
    const err = await create().catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_TAKEN');
    expect(err.meta.suggestions.length).toBe(5);
  });
});

describe('RenameLinkRotationUseCase / DeleteLinkRotationUseCase', () => {
  it('rename reserva o nome antigo por 30 dias para o tenant', async () => {
    const r = deps.rotations.seed({ slug: 'antigo' });
    const out = await new RenameLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, slug: 'novo' });
    expect(out.slug).toBe('novo');
    expect(deps.rotations.reservations).toEqual([
      { domainId: 'dom-1', slug: 'antigo', tenantId: TENANT, expiresAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    expect(await deps.rotations.isSlugAvailable('dom-1', 'antigo', OTHER_TENANT)).toBe(false);
  });

  it('rename para nome tomado → TAKEN, sem reservar nada', async () => {
    const r = deps.rotations.seed({ slug: 'antigo' });
    deps.rotations.seed({ tenantId: OTHER_TENANT, slug: 'novo' });
    await expect(new RenameLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, slug: 'novo' }))
      .rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN' });
    expect(deps.rotations.reservations).toEqual([]);
  });

  it('rename de rotação de outro tenant → NOT_FOUND', async () => {
    const r = deps.rotations.seed({ tenantId: OTHER_TENANT });
    await expect(new RenameLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, slug: 'novo' }))
      .rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
  });

  it('delete apaga grupos e reserva por 30 dias', async () => {
    const r = deps.rotations.seed({ slug: 'some' });
    deps.rotations.seedGroup(r.id);
    await new DeleteLinkRotationUseCase(deps).execute(TENANT, r.id);
    expect(deps.rotations.rotations).toHaveLength(0);
    expect(deps.rotations.groups).toHaveLength(0);
    expect(deps.rotations.reservations[0]).toMatchObject({ slug: 'some', tenantId: TENANT, expiresAt: new Date(NOW.getTime() + 30 * DAY) });
  });
});

describe('namespace público (registry de nomes)', () => {
  it('nome usado por página de ofertas → LINK_SLUG_TAKEN com sugestões', async () => {
    deps.slugs.storefronts.push({ tenantId: OTHER_TENANT, domainId: 'dom-1', slug: 'promodemae', ownerId: 'sf-1' });
    const err = await create().catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_TAKEN');
    expect(err.meta.suggestions).toHaveLength(5);
    // página do próprio tenant (OWNED) também bloqueia o rodízio
    deps.slugs.storefronts[0]!.tenantId = TENANT;
    await expect(create()).rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN' });
  });

  it('nome premium → LINK_SLUG_RESERVED; grant do tenant libera', async () => {
    deps.domains.items = [makeDomain({ premiumNames: ['Ofertas'] })];
    await expect(create({ slug: 'ofertas' })).rejects.toMatchObject({ code: 'LINK_SLUG_RESERVED', meta: { slug: 'ofertas' } });
    deps.slugs.grants.push({ tenantId: TENANT, domainId: 'dom-1', slug: 'ofertas', expiresAt: null });
    await expect(create({ slug: 'ofertas' })).resolves.toMatchObject({ slug: 'ofertas' });
  });

  it('rename com troca de domínio reserva o nome antigo no domínio antigo', async () => {
    deps.domains.items = [makeDomain(), makeDomain({ id: 'dom-2', hostname: 'outro.com.br' })];
    const r = deps.rotations.seed({ slug: 'antigo' });
    const out = await new RenameLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, slug: 'antigo', domainId: 'dom-2' });
    expect(out).toMatchObject({ slug: 'antigo', domainId: 'dom-2' });
    expect(deps.rotations.reservations).toEqual([
      { domainId: 'dom-1', slug: 'antigo', tenantId: TENANT, expiresAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
  });

  it('claim recusado dentro da transação desfaz o rodízio criado', async () => {
    deps.slugs.claim = async () => { throw new LinkSlugTakenError([]); };
    const err = await create().catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_TAKEN');
    expect(err.meta.suggestions).toHaveLength(5);
    expect(deps.rotations.rotations).toHaveLength(0);
  });

  it('delete libera só o nome do rodízio e o reserva', async () => {
    const r = deps.rotations.seed({ slug: 'meu' });
    deps.slugs.storefronts.push({ tenantId: TENANT, domainId: 'dom-1', slug: 'loja-x', ownerId: 'sf-1' });
    await new DeleteLinkRotationUseCase(deps).execute(TENANT, r.id);
    expect(deps.slugs.storefronts).toHaveLength(1);
    expect(deps.rotations.reservations).toMatchObject([{ slug: 'meu', tenantId: TENANT }]);
  });
});

describe('UpdateLinkRotationUseCase', () => {
  it('trocar sessão limpa os grupos', async () => {
    const r = deps.rotations.seed();
    deps.rotations.seedGroup(r.id);
    const out = await new UpdateLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, sessionId: OTHER_SESSION });
    expect(out).toMatchObject({ sessionId: OTHER_SESSION, groups: [] });
    expect(deps.rotations.groups).toHaveLength(0);
  });

  it('mesma sessão mantém grupos; pausa e estratégia gravam', async () => {
    const r = deps.rotations.seed();
    deps.rotations.seedGroup(r.id);
    const out = await new UpdateLinkRotationUseCase(deps).execute({
      tenantId: TENANT, rotationId: r.id, sessionId: SESSION, status: LinkRotationStatus.PAUSED, strategy: 'SEQUENTIAL' as never,
    });
    expect(out).toMatchObject({ status: 'PAUSED', strategy: 'SEQUENTIAL' });
    expect(out.groups).toHaveLength(1);
  });

  it('PAUSED_BY_PLAN não é settable; sessão alheia recusada', async () => {
    const r = deps.rotations.seed();
    const uc = new UpdateLinkRotationUseCase(deps);
    await expect(uc.execute({ tenantId: TENANT, rotationId: r.id, status: LinkRotationStatus.PAUSED_BY_PLAN }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(uc.execute({ tenantId: TENANT, rotationId: r.id, sessionId: 'session-x' }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('reativar PAUSED_BY_PLAN só se couber no plano', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATIONS] = 1;
    deps.rotations.seed();
    const paused = deps.rotations.seed({ status: LinkRotationStatus.PAUSED_BY_PLAN });
    const uc = new UpdateLinkRotationUseCase(deps);
    await expect(uc.execute({ tenantId: TENANT, rotationId: paused.id, status: LinkRotationStatus.ACTIVE }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATIONS] = 2;
    await expect(uc.execute({ tenantId: TENANT, rotationId: paused.id, status: LinkRotationStatus.ACTIVE }))
      .resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('tirar da pausa manual também respeita o plano; rotação pausada não ocupa vaga', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATIONS] = 1;
    const active = deps.rotations.seed();
    const paused = deps.rotations.seed({ status: LinkRotationStatus.PAUSED });
    const uc = new UpdateLinkRotationUseCase(deps);
    await expect(uc.execute({ tenantId: TENANT, rotationId: paused.id, status: LinkRotationStatus.ACTIVE }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await uc.execute({ tenantId: TENANT, rotationId: active.id, status: LinkRotationStatus.PAUSED });
    await expect(uc.execute({ tenantId: TENANT, rotationId: paused.id, status: LinkRotationStatus.ACTIVE }))
      .resolves.toMatchObject({ status: 'ACTIVE' });
  });
});

describe('SaveLinkRotationGroupsUseCase', () => {
  const save = (rotationId: string, groups: Parameters<SaveLinkRotationGroupsUseCase['execute']>[0]['groups']) =>
    new SaveLinkRotationGroupsUseCase(deps).execute({ tenantId: TENANT, rotationId, groups });

  it('aceita menos grupos que o limite; AUTO com code; posição sequencial e defaults', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS] = 3;
    deps.groups.add('a').add('b');
    const r = deps.rotations.seed();
    const out = await save(r.id, [{ conversationId: 'b', position: 5 }, { conversationId: 'a', position: 1, weight: 7, capacity: 50 }]);
    expect(out.map((g) => [g.conversationId, g.position])).toEqual([['a', 0], ['b', 1]]);
    expect(out[0]).toMatchObject({ weight: 7, capacity: 50, linkSource: 'AUTO', status: 'ACTIVE', inviteUrl: `https://chat.whatsapp.com/${CODE}`, groupName: 'Grupo a' });
    expect(out[1]).toMatchObject({ weight: 1, capacity: 1000 });
  });

  it('acima do limite de grupos → PLAN_LIMIT_REACHED', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS] = 1;
    deps.groups.add('a').add('b');
    const r = deps.rotations.seed();
    await expect(save(r.id, [{ conversationId: 'a' }, { conversationId: 'b' }]))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotation_groups', limit: 1 } });
  });

  it('GROUP_INVITE_NOT_ALLOWED → NEEDS_LINK sem code', async () => {
    deps.groups.add('a');
    deps.engine.invites.set('jid-a', new GroupInviteNotAllowedError());
    const r = deps.rotations.seed();
    const [g] = await save(r.id, [{ conversationId: 'a' }]);
    expect(g).toMatchObject({ status: 'NEEDS_LINK', linkSource: null, inviteUrl: null });
  });

  it('sessão desconectada não derruba: mantém AUTO anterior ou NEEDS_LINK', async () => {
    deps.groups.add('a').add('b');
    deps.engine.invites.set('jid-a', new SessionNotConnectedError(SESSION));
    deps.engine.invites.set('jid-b', new SessionNotConnectedError(SESSION));
    const r = deps.rotations.seed();
    deps.rotations.seedGroup(r.id, { conversationId: 'a', groupJid: 'jid-a', linkSource: LinkRotationGroupLinkSource.AUTO, inviteCode: CODE });
    const out = await save(r.id, [{ conversationId: 'a' }, { conversationId: 'b' }]);
    expect(out.map((g) => [g.status, g.linkSource])).toEqual([['ACTIVE', 'AUTO'], ['NEEDS_LINK', null]]);
  });

  it('manual inválido → LINK_INVITE_URL_INVALID, sem chamar o engine', async () => {
    deps.groups.add('a').add('b');
    const r = deps.rotations.seed();
    await expect(save(r.id, [{ conversationId: 'a' }, { conversationId: 'b', manualInviteUrl: 'https://wa.me/123' }]))
      .rejects.toMatchObject({ code: 'LINK_INVITE_URL_INVALID' });
    expect(deps.engine.inviteCalls).toEqual([]);
  });

  it('manual válido grava só o code (MANUAL) e é mantido quando o campo vem ausente', async () => {
    deps.groups.add('a');
    const r = deps.rotations.seed();
    const [g] = await save(r.id, [{ conversationId: 'a', manualInviteUrl: `chat.whatsapp.com/${CODE}?mode=x` }]);
    expect(g).toMatchObject({ linkSource: 'MANUAL', inviteUrl: `https://chat.whatsapp.com/${CODE}`, status: 'ACTIVE' });
    expect(deps.rotations.groups[0]!.inviteCode).toBe(CODE);
    const [again] = await save(r.id, [{ conversationId: 'a' }]);
    expect(again!.linkSource).toBe('MANUAL');
    expect(deps.engine.inviteCalls).toEqual([]);
    const [auto] = await save(r.id, [{ conversationId: 'a', manualInviteUrl: null }]);
    expect(auto!.linkSource).toBe('AUTO');
  });

  it('grupo de outra sessão, de outro tenant ou inexistente → LINK_GROUP_INVALID', async () => {
    deps.groups.add('outra-sessao', { sessionId: OTHER_SESSION }).add('alheio', { tenantId: OTHER_TENANT });
    const r = deps.rotations.seed();
    for (const conversationId of ['outra-sessao', 'alheio', 'nao-existe']) {
      await expect(save(r.id, [{ conversationId }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
    }
  });

  it('duplicado e faixas inválidas → LINK_GROUP_INVALID', async () => {
    deps.groups.add('a');
    const r = deps.rotations.seed();
    await expect(save(r.id, [{ conversationId: 'a' }, { conversationId: 'a' }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
    await expect(save(r.id, [{ conversationId: 'a', capacity: 49 }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
    await expect(save(r.id, [{ conversationId: 'a', capacity: 1025 }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
    await expect(save(r.id, [{ conversationId: 'a', weight: 0 }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
    await expect(save(r.id, [{ conversationId: 'a', weight: 101 }])).rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
  });

  it('lotado pela última contagem → FULL; rotação de outro tenant → NOT_FOUND', async () => {
    deps.groups.add('a');
    const r = deps.rotations.seed();
    deps.rotations.seedGroup(r.id, { conversationId: 'a', memberCount: 60 });
    const [g] = await save(r.id, [{ conversationId: 'a', capacity: 50 }]);
    expect(g!.status).toBe('FULL');
    const alien = deps.rotations.seed({ tenantId: OTHER_TENANT });
    await expect(save(alien.id, [])).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
  });
});

describe('RefreshLinkRotationGroupUseCase', () => {
  it('atualiza membros, zera clicksSinceSync e marca FULL pelo teto', async () => {
    const r = deps.rotations.seed();
    const g = deps.rotations.seedGroup(r.id, { groupJid: 'j', capacity: 100, clicksSinceSync: 9, linkSource: LinkRotationGroupLinkSource.AUTO });
    deps.engine.summaries.set('j', { name: 'Promo', memberCount: 100, isSelfAdmin: true });
    const out = await new RefreshLinkRotationGroupUseCase(deps).execute({ tenantId: TENANT, rotationId: r.id, groupId: g.id });
    expect(out).toMatchObject({ status: 'FULL', memberCount: 100, memberCountAt: NOW, clicksSinceSync: 0, groupName: 'Promo', linkSource: 'AUTO' });
  });

  it('AUTO revogado → NEEDS_LINK; NEEDS_LINK volta a ACTIVE quando o convite sai', async () => {
    const r = deps.rotations.seed();
    const g = deps.rotations.seedGroup(r.id, { groupJid: 'j', linkSource: LinkRotationGroupLinkSource.AUTO });
    deps.engine.invites.set('j', new GroupInviteNotAllowedError());
    const uc = new RefreshLinkRotationGroupUseCase(deps);
    expect(await uc.execute({ tenantId: TENANT, rotationId: r.id, groupId: g.id })).toMatchObject({ status: 'NEEDS_LINK', inviteUrl: null });
    deps.engine.invites.set('j', CODE);
    expect(await uc.execute({ tenantId: TENANT, rotationId: r.id, groupId: g.id })).toMatchObject({ status: 'ACTIVE', linkSource: 'AUTO' });
  });

  it('MANUAL não chama convite; sessão desconectada sobe o erro', async () => {
    const r = deps.rotations.seed();
    const g = deps.rotations.seedGroup(r.id, { groupJid: 'j', linkSource: LinkRotationGroupLinkSource.MANUAL });
    const uc = new RefreshLinkRotationGroupUseCase(deps);
    await uc.execute({ tenantId: TENANT, rotationId: r.id, groupId: g.id });
    expect(deps.engine.inviteCalls).toEqual([]);
    deps.engine.summaries.set('j', new SessionNotConnectedError(SESSION));
    await expect(uc.execute({ tenantId: TENANT, rotationId: r.id, groupId: g.id })).rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED' });
  });
});

describe('GetLinkRotationOverviewUseCase', () => {
  it('rotações do tenant com nomes, só domínios ACTIVE, limites e sessões', async () => {
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATIONS] = 2;
    deps.domains.items.push(makeDomain({ id: 'dom-2', hostname: 'pausado.app', status: LinkDomainStatus.PAUSED }));
    deps.groups.add('a');
    const r = deps.rotations.seed({ slug: 'meu', domainId: 'dom-2' });
    deps.rotations.seedGroup(r.id, { conversationId: 'a' });
    deps.rotations.seed({ tenantId: OTHER_TENANT });
    const out = await new GetLinkRotationOverviewUseCase(deps).execute(TENANT);
    expect(out.rotations).toHaveLength(1);
    expect(out.rotations[0]).toMatchObject({ publicUrl: 'https://meu.pausado.app', groups: [{ groupName: 'Grupo a' }] });
    expect(out.domains).toEqual([{ id: 'dom-1', hostname: 'copysync.com.br' }]);
    expect(out.limits).toEqual({ linkRotations: 2, linkRotationGroups: null });
    expect(out.sessions.map((s) => s.id)).toEqual([SESSION, OTHER_SESSION]);
  });
});
