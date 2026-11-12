import { describe, expect, it, beforeEach } from 'vitest';
import {
  CreateOfferHuntUseCase, DeleteOfferHuntUseCase, GetOfferHuntUseCase, ListOfferHuntsUseCase, PauseOfferHuntUseCase,
  ResumeOfferHuntUseCase, UpdateOfferHuntUseCase, type OfferHuntCrudDeps,
} from './OfferHuntCrudUseCases';
import type { CreateOfferHuntInput, OfferHuntPatch } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { OfferHunt, OfferHuntPauseReason } from '../../../domain/hunter/OfferHunt';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { makeHunt, NOW, TENANT } from './hunterTestFakes';

type HuntsPort = OfferHuntCrudDeps['hunts'];
class Hunts implements HuntsPort {
  items: OfferHunt[] = [];
  private seq = 0;
  async createWithinLimit(input: CreateOfferHuntInput, max: number) {
    if (this.items.filter((h) => h.tenantId === input.tenantId).length >= max) return null;
    const { tenantId, nextRunAt, ...def } = input;
    const h = makeHunt({ ...def, id: `h${++this.seq}`, tenantId, nextRunAt });
    this.items.push(h);
    return h;
  }
  async findById(tenantId: string, id: string) { return this.items.find((h) => h.id === id && h.tenantId === tenantId) ?? null; }
  async listByTenant(tenantId: string) { return this.items.filter((h) => h.tenantId === tenantId); }
  async update(tenantId: string, id: string, patch: OfferHuntPatch) {
    const h = await this.findById(tenantId, id);
    if (!h) return null;
    Object.assign(h, patch);
    return h;
  }
  async delete(tenantId: string, id: string) {
    const before = this.items.length;
    this.items = this.items.filter((h) => !(h.id === id && h.tenantId === tenantId));
    return this.items.length < before;
  }
  async pause(tenantId: string, id: string, reason: OfferHuntPauseReason) {
    const h = await this.findById(tenantId, id);
    if (!h) return false;
    Object.assign(h, { status: 'PAUSED', pauseReason: reason });
    return true;
  }
  async resume(tenantId: string, id: string, nextRunAt: Date | null) {
    const h = await this.findById(tenantId, id);
    if (!h || h.status !== 'PAUSED') return false;
    Object.assign(h, { status: 'ACTIVE', pauseReason: null, consecutiveFailures: 0, nextRunAt });
    return true;
  }
}

let hunts: Hunts;
let ent: Record<string, unknown>;
let deps: OfferHuntCrudDeps;

beforeEach(() => {
  hunts = new Hunts();
  ent = { [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: true };
  deps = {
    hunts,
    entitlements: {
      getBoolean: async (_t, k) => (typeof ent[k] === 'boolean' ? (ent[k] as boolean) : null),
      getNumber: async () => null,
    },
    now: () => NOW,
  };
});

const create = (name = 'Caça', extra = {}) => new CreateOfferHuntUseCase(deps).execute({ tenantId: TENANT, definition: { name, ...extra } });

describe('CreateOfferHuntUseCase', () => {
  it('cria com padrões e 1ª execução em now + intervalo', async () => {
    const h = await create('  Comissão  ', { intervalMinutes: 30 });
    expect(h).toMatchObject({ name: 'Comissão', topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 30 });
    expect(h.nextRunAt?.toISOString()).toBe('2026-11-12T15:30:00.000Z');
  });

  it('6ª caçada → 409 OFFER_HUNT_LIMIT_REACHED', async () => {
    for (let i = 0; i < 5; i++) await create(`c${i}`);
    await expect(create('sexta')).rejects.toMatchObject({ code: 'OFFER_HUNT_LIMIT_REACHED', statusCode: 409 });
  });

  it('campo inválido → 422 com o campo, nada gravado', async () => {
    await expect(create('x', { topN: 9 })).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field: 'topN' } });
    expect(hunts.items).toHaveLength(0);
  });

  it('sem offer_hunter_enabled → 403', async () => {
    ent = {};
    await expect(create()).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });
});

describe('UpdateOfferHuntUseCase', () => {
  it('ativa: mescla e recalcula nextRunAt', async () => {
    const h = await create();
    const up = await new UpdateOfferHuntUseCase({ ...deps, now: () => new Date('2026-11-12T16:00:00Z') })
      .execute({ tenantId: TENANT, huntId: h.id, definition: { intervalMinutes: 120, keyword: 'vestido' } });
    expect(up).toMatchObject({ name: 'Caça', intervalMinutes: 120, keyword: 'vestido' });
    expect(up.nextRunAt?.toISOString()).toBe('2026-11-12T18:00:00.000Z');
  });

  it('pausada: não agenda', async () => {
    const h = await create();
    await new PauseOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id });
    const before = h.nextRunAt;
    const up = await new UpdateOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id, definition: { intervalMinutes: 300 } });
    expect(up.nextRunAt).toBe(before);
  });

  it('outro tenant → 404', async () => {
    const h = await create();
    await expect(new UpdateOfferHuntUseCase(deps).execute({ tenantId: 'other', huntId: h.id, definition: { topN: 2 } }))
      .rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
  });
});

describe('pausa, retomada, exclusão, leitura', () => {
  it('pausa USER; retoma limpa motivo, zera falhas e recalcula', async () => {
    const h = await create();
    Object.assign(h, { status: 'PAUSED', pauseReason: 'SOURCE_UNAVAILABLE', consecutiveFailures: 3, nextRunAt: null });
    const r = await new ResumeOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id });
    expect(r).toMatchObject({ status: 'ACTIVE', pauseReason: null, consecutiveFailures: 0 });
    expect(r.nextRunAt?.toISOString()).toBe('2026-11-12T16:00:00.000Z');
    const p = await new PauseOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id });
    expect(p).toMatchObject({ status: 'PAUSED', pauseReason: 'USER' });
  });

  it('retomar já ativa devolve como está; retomar sem entitlement → 403', async () => {
    const h = await create();
    expect((await new ResumeOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).status).toBe('ACTIVE');
    await new PauseOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id });
    ent = {};
    await expect(new ResumeOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('exclui, lista, obtém; inexistente → 404', async () => {
    const h = await create();
    expect(await new ListOfferHuntsUseCase(deps).execute(TENANT)).toHaveLength(1);
    expect((await new GetOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).id).toBe(h.id);
    await new DeleteOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id });
    await expect(new DeleteOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(new PauseOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).rejects.toMatchObject({ statusCode: 404 });
    await expect(new GetOfferHuntUseCase(deps).execute({ tenantId: TENANT, huntId: h.id })).rejects.toMatchObject({ statusCode: 404 });
  });
});
