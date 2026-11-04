import { beforeEach, describe, expect, it } from 'vitest';
import { ENTITLEMENT_KEYS as K } from '../../../tenants/domain/entitlementKeys';
import { PLAN_PRESETS } from '../../../tenants/domain/planPresets';
import { LinkRotationStatus } from '../../domain/enums/LinkRotationEnums';
import { CreateLinkRotationUseCase } from './CreateLinkRotationUseCase';
import { GetLinkRotationOverviewUseCase } from './GetLinkRotationOverviewUseCase';
import { SaveLinkRotationGroupsUseCase } from './SaveLinkRotationGroupsUseCase';
import { UpdateLinkRotationUseCase } from './UpdateLinkRotationUseCase';
import { makeDeps, SESSION, TENANT } from './linkRotationTestFakes';

/** Limites do rodízio por canal: canal = engine da sessão do rodízio (docs/rodizio-de-links.md). */
const TG_SESSION = 'session-tg';
let deps: ReturnType<typeof makeDeps>;

/** Entitlements do tenant = presets do plano (só as chaves numéricas do rodízio). */
function usePlan(slug: keyof typeof PLAN_PRESETS) {
  for (const key of [K.LINK_ROTATIONS, K.LINK_ROTATION_GROUPS, K.TELEGRAM_LINK_ROTATIONS, K.TELEGRAM_LINK_ROTATION_GROUPS]) {
    deps.entitlements.numbers[key] = PLAN_PRESETS[slug][key] as number;
  }
}

beforeEach(() => {
  deps = makeDeps();
  deps.sessions.items.push({ id: TG_SESSION, tenantId: TENANT, name: 'Telegram', status: 'CONNECTED', channel: 'telegram', phone: null });
  deps.rotations.sessionChannels[TG_SESSION] = 'telegram';
});

const create = (sessionId: string, slug: string) =>
  new CreateLinkRotationUseCase(deps).execute({ tenantId: TENANT, sessionId, domainId: 'dom-1', slug });

describe('limites do rodízio por canal', () => {
  it('Pro: 1 WhatsApp + 1 Telegram independentes; o 2º de cada canal esbarra na chave do canal', async () => {
    usePlan('COPYSYNC_PRO');
    await expect(create(SESSION, 'ofertaszap')).resolves.toMatchObject({ channel: 'whatsapp' });
    await expect(create(TG_SESSION, 'ofertastele')).resolves.toMatchObject({ channel: 'telegram' });
    await expect(create(SESSION, 'ofertaszap2')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotations', limit: 1 } });
    await expect(create(TG_SESSION, 'ofertastele2'))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotations', limit: 1 } });
  });

  it('Lite sem Telegram: rodízio Telegram recusado, WhatsApp liberado', async () => {
    usePlan('COPYSYNC_LITE');
    await expect(create(TG_SESSION, 'ofertastele'))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotations', limit: 0 } });
    await expect(create(SESSION, 'ofertaszap')).resolves.toMatchObject({ channel: 'whatsapp' });
  });

  it('grupos por rodízio usam a chave do canal do rodízio', async () => {
    usePlan('COPYSYNC_PRO');
    deps.entitlements.numbers[K.LINK_ROTATION_GROUPS] = 10;
    const tg = deps.rotations.seed({ sessionId: TG_SESSION, channel: 'telegram' });
    const ids = Array.from({ length: 6 }, (_, i) => `t${i}`);
    for (const id of ids) deps.groups.add(id, { sessionId: TG_SESSION });
    await expect(new SaveLinkRotationGroupsUseCase(deps).execute({
      tenantId: TENANT, rotationId: tg.id, groups: ids.map((conversationId) => ({ conversationId })),
    })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotation_groups', limit: 5 } });
  });

  it('trocar a sessão para outro canal: ACTIVE precisa caber no limite do canal novo', async () => {
    usePlan('COPYSYNC_PRO');
    deps.rotations.seed({ sessionId: TG_SESSION, channel: 'telegram' });
    const wa = deps.rotations.seed();
    const uc = new UpdateLinkRotationUseCase(deps);
    await expect(uc.execute({ tenantId: TENANT, rotationId: wa.id, sessionId: TG_SESSION }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_link_rotations', limit: 1 } });
    // Pausado não ocupa vaga: pode mudar de canal e só volta a ACTIVE se couber.
    await uc.execute({ tenantId: TENANT, rotationId: wa.id, status: LinkRotationStatus.PAUSED });
    await expect(uc.execute({ tenantId: TENANT, rotationId: wa.id, sessionId: TG_SESSION }))
      .resolves.toMatchObject({ channel: 'telegram', status: 'PAUSED' });
  });

  it('reativar respeita só o canal do rodízio', async () => {
    usePlan('COPYSYNC_PRO');
    deps.rotations.seed({ sessionId: TG_SESSION, channel: 'telegram' });
    const wa = deps.rotations.seed({ status: LinkRotationStatus.PAUSED_BY_PLAN });
    await expect(new UpdateLinkRotationUseCase(deps).execute({ tenantId: TENANT, rotationId: wa.id, status: LinkRotationStatus.ACTIVE }))
      .resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('overview expõe limites e uso por canal (campos legados = WhatsApp)', async () => {
    usePlan('COPYSYNC_MAX');
    deps.rotations.seed();
    deps.rotations.seed({ sessionId: TG_SESSION, channel: 'telegram' });
    deps.rotations.seed({ sessionId: TG_SESSION, channel: 'telegram', status: LinkRotationStatus.PAUSED });
    const out = await new GetLinkRotationOverviewUseCase(deps).execute(TENANT);
    expect(out.limits).toEqual({
      linkRotations: 2, linkRotationGroups: 10,
      whatsapp: { rotations: 2, groupsPerRotation: 10 }, telegram: { rotations: 2, groupsPerRotation: 10 },
    });
    expect(out.usage).toEqual({ whatsapp: { rotations: 1 }, telegram: { rotations: 2 } });
  });
});
