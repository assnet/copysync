import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/** Banco em memória: tenant único por `billingCustomerId`, recibos por `eventId`. */
const db = vi.hoisted(() => {
  type Tenant = { id: string; status: string; lastBillingEventSeq: bigint | null; planSlug: string | null; suspendedAt: Date | null; subscriptionExpiresAt?: Date | null; adminBlockedAt?: Date | null };
  const state = {
    tenant: null as Tenant | null,
    receipts: new Map<string, { outcome: string; tenantId: string | null; type: string }>(),
    entitlements: new Map<string, unknown>(),
    locked: 0,
    /** Força P2002 no create do recibo (outra requisição gravou o mesmo eventId). */
    receiptRace: false,
    /** Tenants fora do cliente do evento (vínculo pelo e-mail), por id. */
    others: new Map<string, Tenant & { billingCustomerId: string | null }>(),
    users: new Map<string, string>(),
    memberships: [] as { userId: string; tenantId: string; role: string }[],
    audits: [] as { tenantId?: string; action: string; meta?: Record<string, unknown> }[],
    /** Candidato vinculado a outro cliente entre a leitura e o lock. */
    candidateGone: false,
  };
  const row = (t: Tenant) => ({ id: t.id, status: t.status, lastBillingEventSeq: t.lastBillingEventSeq, adminBlockedAt: t.adminBlockedAt ?? null });
  const client = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      state.locked++;
      if (sql.join('?').includes('"id" =')) {
        const t = state.others.get(values[0] as string);
        return t && t.billingCustomerId === null && !state.candidateGone ? [row(t)] : [];
      }
      return state.tenant ? [row(state.tenant)] : [];
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => (state.users.has(where.email) ? { id: state.users.get(where.email)! } : null),
    },
    userTenant: {
      findMany: async ({ where }: { where: { userId: string; role: string } }) => state.memberships
        .filter((m) => m.userId === where.userId && m.role === where.role)
        .map((m) => ({ tenantId: m.tenantId, tenant: { billingCustomerId: state.others.has(m.tenantId) ? state.others.get(m.tenantId)!.billingCustomerId : 'linked' } })),
      findFirst: async ({ where }: { where: { userId: string; tenantId: string; role: string } }) =>
        state.memberships.find((m) => m.userId === where.userId && m.tenantId === where.tenantId && m.role === where.role) ? { id: 'ut' } : null,
    },
    auditLog: {
      create: async ({ data }: { data: { tenantId?: string; action: string; meta?: Record<string, unknown> } }) => { state.audits.push(data); return {}; },
    },
    billingEventReceipt: {
      findUnique: async ({ where }: { where: { eventId: string } }) => state.receipts.get(where.eventId) ?? null,
      create: async ({ data }: { data: { eventId: string; outcome: string; tenantId: string | null; type: string } }) => {
        if (state.receiptRace) {
          state.receipts.set(data.eventId, { outcome: 'APPLIED', tenantId: null, type: data.type });
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['eventId'] } });
        }
        state.receipts.set(data.eventId, { outcome: data.outcome, tenantId: data.tenantId, type: data.type });
        return {};
      },
    },
    tenant: {
      findUnique: async () => (state.tenant ? { id: state.tenant.id, lastBillingEventSeq: state.tenant.lastBillingEventSeq } : null),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Tenant> & { billingCustomerId?: string } }) => {
        const other = state.others.get(where.id);
        if (other && data.billingCustomerId) {
          state.others.delete(where.id);
          state.tenant = Object.assign(other, data);
        } else Object.assign(state.tenant!, data);
        return {};
      },
      updateMany: async ({ data }: { data: { lastBillingEventSeq: bigint } }) => {
        const t = state.tenant!;
        if (t.lastBillingEventSeq === null || t.lastBillingEventSeq < data.lastBillingEventSeq) t.lastBillingEventSeq = data.lastBillingEventSeq;
        return { count: 1 };
      },
    },
    planEntitlementPreset: {
      findMany: async ({ where }: { where: { planSlug: string } }) => [
        { key: 'whatsapp_sessions', value: where.planSlug === 'COPYSYNC_MAX' ? '2' : '1' },
        { key: 'offer_generations_per_day', value: where.planSlug === 'COPYSYNC_MAX' ? null : 20 },
      ],
    },
    tenantEntitlement: {
      upsert: async ({ create, update }: { create: { key: string; value: unknown }; update: { value: unknown } }) => {
        state.entitlements.set(create.key, state.entitlements.has(create.key) ? update.value : create.value);
        return {};
      },
    },
  };
  const txOptions: unknown[] = [];
  const prisma = {
    ...client,
    $transaction: async (fn: (t: typeof client) => Promise<unknown>, opts?: unknown) => { txOptions.push(opts); return fn(client); },
  };
  return { state, prisma, txOptions };
});

const emit = vi.hoisted(() => vi.fn());
const sideEffects = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../../shared/database/prisma.client', () => ({ prisma: db.prisma }));
vi.mock('../../../shared/events/InternalEventBus', () => ({ internalEventBus: { emit } }));
vi.mock('./applyPlanSideEffects', () => ({ applyPlanSideEffects: sideEffects }));

import { ApplyBillingEventUseCase, classifyHubLookupFailure, hubLookupFailureCounts, type ApplyBillingEventInput } from './ApplyBillingEventUseCase';
import { SlugTakenError } from '../../../shared/errors/internal/TeamErrors';

function makeTenant(over: Partial<NonNullable<typeof db.state.tenant>> = {}) {
  db.state.tenant = { id: 'tenant-1', status: 'ACTIVE', lastBillingEventSeq: 10n, planSlug: 'COPYSYNC_LITE', suspendedAt: null, ...over };
}

function ev(eventType: string, over: Partial<ApplyBillingEventInput> = {}): ApplyBillingEventInput {
  return {
    eventId: `ev-${eventType}`,
    billingCustomerId: 'user-central-1',
    eventType,
    seq: 11n,
    payload: { email: 'ana@exemplo.com', name: 'Ana Souza', planSlug: 'COPYSYNC_PRO' },
    ...over,
  };
}

const provisioner = { execute: vi.fn() };
/** Central: `GET /integrations/subscriptions` (padrão: lista sem assinatura válida → corte). */
const hub = { fetchByCustomer: vi.fn() };
const NOW_ISO = Date.now();
const iso = (days: number) => new Date(NOW_ISO + days * 86_400_000).toISOString();
const hubSub = (o: Record<string, unknown> = {}) => ({ id: 's-old', planSlug: 'copysync-pro-mensal', billingStatus: 'ACTIVE', expiresAt: iso(10), deletedAt: null, ...o });
const hubOk = (subscriptions: unknown[]) => ({ ok: true, snapshot: { externalUserId: 'user-central-1', subscriptions, lastSeq: 11n } });

beforeEach(() => {
  db.state.tenant = null;
  db.state.receipts.clear();
  db.state.entitlements.clear();
  db.state.locked = 0;
  db.state.receiptRace = false;
  db.state.others.clear();
  db.state.users.clear();
  db.state.memberships.length = 0;
  db.state.audits.length = 0;
  db.state.candidateGone = false;
  db.txOptions.length = 0;
  hub.fetchByCustomer.mockReset();
  hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' })]));
  provisioner.execute.mockReset();
  provisioner.execute.mockImplementation(async () => {
    makeTenant({ lastBillingEventSeq: null, planSlug: 'COPYSYNC_PRO' });
    return { tenantId: 'tenant-1', userId: 'u1', inviteLink: null, emailSent: false, existingAccount: false };
  });
});

const run = (input: ApplyBillingEventInput) => new ApplyBillingEventUseCase(provisioner, hub).execute(input);

describe('ApplyBillingEventUseCase', () => {
  it('ativação de cliente desconhecido provisiona o tenant e aplica o plano', async () => {
    const out = await run(ev('subscription.activated'));
    expect(provisioner.execute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ana Souza',
      owner: { email: 'ana@exemplo.com', name: 'Ana Souza' },
      billingCustomerId: 'user-central-1',
      planSlug: 'COPYSYNC_PRO',
      origin: 'BILLING_WEBHOOK',
      slug: expect.stringMatching(/^ana-souza-[a-f0-9]{6}$/),
    }));
    expect(out).toEqual({ outcome: 'APPLIED', tenantId: 'tenant-1' });
    expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 11n });
    expect(db.state.entitlements.get('whatsapp_sessions')).toBe('1');
    expect(sideEffects).toHaveBeenCalled();
    expect(db.state.receipts.get('ev-subscription.activated')?.outcome).toBe('APPLIED');
  });

  it('sem nome usa a parte local do e-mail e tenta outro slug quando o primeiro já existe', async () => {
    const ok = provisioner.execute.getMockImplementation()!;
    provisioner.execute.mockRejectedValueOnce(new SlugTakenError()).mockImplementationOnce(ok);
    await run(ev('subscription.activated', { payload: { email: 'bia@x.com', planSlug: 'COPYSYNC_LITE' } }));
    expect(provisioner.execute).toHaveBeenCalledTimes(2);
    expect(provisioner.execute.mock.calls[1]![0]).toMatchObject({ name: 'bia', slug: expect.stringMatching(/^bia-/) });
  });

  it('planSlug da oferta da central (copysync-max-anual) provisiona com o tier interno', async () => {
    await run(ev('subscription.activated', { payload: { email: 'bia@x.com', planSlug: 'copysync-max-anual' } }));
    expect(provisioner.execute.mock.calls[0]![0]).toMatchObject({ planSlug: 'COPYSYNC_MAX' });
  });

  it('slug ocupado nas 3 tentativas propaga o erro (hub reenvia)', async () => {
    provisioner.execute.mockRejectedValue(new SlugTakenError());
    await expect(run(ev('subscription.activated'))).rejects.toBeInstanceOf(SlugTakenError);
    expect(provisioner.execute).toHaveBeenCalledTimes(3);
    expect(db.state.receipts.size).toBe(0);
  });

  it('ativação de cliente novo com plano desconhecido: não provisiona, não grava recibo (hub retém)', async () => {
    const out = await run(ev('subscription.activated', { payload: { email: 'ana@exemplo.com', planSlug: 'starter' } }));
    expect(provisioner.execute).not.toHaveBeenCalled();
    expect(out).toEqual({ outcome: 'UNPROVISIONABLE', reason: 'invalid_plan_slug' });
    expect(db.state.receipts.size).toBe(0);
  });

  it('ativação de cliente novo sem e-mail: não provisiona, não grava recibo (hub retém)', async () => {
    const out = await run(ev('subscription.activated', { payload: { planSlug: 'COPYSYNC_PRO' } }));
    expect(provisioner.execute).not.toHaveBeenCalled();
    expect(out).toEqual({ outcome: 'UNPROVISIONABLE', reason: 'missing_email' });
    expect(db.state.receipts.size).toBe(0);
  });

  it('ativação de cliente já existente com plano desconhecido reativa sem gravar plano (200)', async () => {
    makeTenant({ status: 'SUSPENDED' });
    const out = await run(ev('subscription.activated', { payload: { planSlug: 'starter' } }));
    expect(out.outcome).toBe('APPLIED');
    expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_LITE' });
    expect(db.state.entitlements.size).toBe(0);
  });

  it('transação com timeout e maxWait explícitos', async () => {
    makeTenant();
    await run(ev('subscription.updated'));
    expect(db.txOptions).toEqual([{ timeout: 15_000, maxWait: 5_000 }]);
  });

  it('evento já recebido devolve DUPLICATE sem reaplicar', async () => {
    makeTenant({ status: 'CANCELLED' });
    db.state.receipts.set('ev-subscription.renewed', { outcome: 'APPLIED', tenantId: 'tenant-1', type: 'subscription.renewed' });
    expect((await run(ev('subscription.renewed'))).outcome).toBe('DUPLICATE');
    expect(db.state.tenant!.status).toBe('CANCELLED');
  });

  it('recibo gravado por requisição concorrente (P2002) vira DUPLICATE, não 500', async () => {
    makeTenant();
    db.state.receiptRace = true;
    expect((await run(ev('subscription.updated'))).outcome).toBe('DUPLICATE');
  });

  it('seq menor ou igual à marca d’água vira OUT_OF_ORDER com recibo e sem efeito', async () => {
    makeTenant({ status: 'ACTIVE' });
    const out = await run(ev('subscription.canceled', { seq: 10n }));
    expect(out).toEqual({ outcome: 'OUT_OF_ORDER', tenantId: 'tenant-1' });
    expect(db.state.receipts.get('ev-subscription.canceled')?.outcome).toBe('OUT_OF_ORDER');
    expect(db.state.tenant!.status).toBe('ACTIVE');
    expect(emit).not.toHaveBeenCalled();
    expect(hub.fetchByCustomer).not.toHaveBeenCalled();
  });

  it('trava a linha do tenant na transação', async () => {
    makeTenant();
    await run(ev('subscription.updated'));
    expect(db.state.locked).toBe(1);
  });

  it('atualização troca o plano mas não reativa conta cancelada', async () => {
    makeTenant({ status: 'CANCELLED', suspendedAt: new Date('2026-10-01') });
    const out = await run(ev('subscription.updated', { payload: { planSlug: 'COPYSYNC_MAX' } }));
    expect(out.outcome).toBe('APPLIED');
    expect(db.state.tenant).toMatchObject({ status: 'CANCELLED', planSlug: 'COPYSYNC_MAX' });
    expect(db.state.entitlements.get('whatsapp_sessions')).toBe('2');
  });

  it('upgrade PRO→MAX sobrescreve o limite gravado com JSON null (ilimitado), não herda 20', async () => {
    makeTenant({ planSlug: 'COPYSYNC_PRO' });
    await run(ev('subscription.updated', { eventId: 'ev-pro', payload: { planSlug: 'COPYSYNC_PRO' } }));
    expect(db.state.entitlements.get('offer_generations_per_day')).toBe(20);
    await run(ev('subscription.updated', { eventId: 'ev-max', seq: 12n, payload: { planSlug: 'COPYSYNC_MAX' } }));
    expect(db.state.entitlements.get('offer_generations_per_day')).toBe(Prisma.JsonNull);
  });

  it('plano desconhecido em renovação: reativa mas não grava plano nem entitlements', async () => {
    makeTenant({ status: 'SUSPENDED', suspendedAt: new Date() });
    await run(ev('subscription.renewed', { payload: { planSlug: 'gold' } }));
    expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', suspendedAt: null, planSlug: 'COPYSYNC_LITE' });
    expect(db.state.entitlements.size).toBe(0);
  });

  it('falha de pagamento sem assinatura válida suspende e emite TENANT_SUSPENDED depois do commit', async () => {
    makeTenant();
    const out = await run(ev('subscription.payment_failed', { payload: {} }));
    expect(hub.fetchByCustomer).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe('APPLIED');
    expect(db.state.tenant!.status).toBe('SUSPENDED');
    expect(db.state.tenant!.suspendedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: 'tenant-1' });
  });

  it.each(['subscription.canceled', 'subscription.expired', 'subscription.refunded', 'subscription.chargedback'])(
    '%s sem assinatura válida na central cancela a conta e emite TENANT_SUSPENDED',
    async (type) => {
      makeTenant();
      expect((await run(ev(type, { payload: {} }))).outcome).toBe('APPLIED');
      expect(db.state.tenant!.status).toBe('CANCELLED');
      expect(emit).toHaveBeenCalledTimes(1);
      expect(hub.fetchByCustomer).toHaveBeenCalledWith('user-central-1');
    },
  );

  describe('evento de corte decidido pela união das assinaturas', () => {
    it('renovação (linha nova) + expired da linha antiga: mantém ACTIVE com o vencimento novo', async () => {
      makeTenant({ planSlug: 'COPYSYNC_PRO' });
      hub.fetchByCustomer.mockResolvedValue(hubOk([
        hubSub({ billingStatus: 'EXPIRED', expiresAt: iso(-1) }),
        hubSub({ id: 's-new', expiresAt: iso(30) }),
      ]));
      const out = await run(ev('subscription.expired', { payload: {} }));
      expect(out).toEqual({ outcome: 'KEPT_ACTIVE', tenantId: 'tenant-1' });
      expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 11n, subscriptionExpiresAt: new Date(iso(30)) });
      expect(db.state.receipts.get('ev-subscription.expired')?.outcome).toBe('KEPT_ACTIVE');
      expect(emit).not.toHaveBeenCalled();
    });

    it('reembolso de ciclo antigo com ciclo novo válido: mantém', async () => {
      makeTenant();
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' }), hubSub({ id: 's-new', expiresAt: iso(30) })]));
      expect((await run(ev('subscription.refunded', { payload: {} }))).outcome).toBe('KEPT_ACTIVE');
      expect(db.state.tenant!.status).toBe('ACTIVE');
    });

    it('reembolso da única assinatura: corta', async () => {
      makeTenant();
      expect((await run(ev('subscription.refunded', { payload: {} }))).outcome).toBe('APPLIED');
      expect(db.state.tenant!.status).toBe('CANCELLED');
    });

    it('cancelamento da recorrência na Cakto (central segue ACTIVE no ciclo): mantém', async () => {
      makeTenant({ status: 'SUSPENDED', suspendedAt: new Date() });
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ expiresAt: iso(5) })]));
      expect((await run(ev('subscription.canceled', { payload: {} }))).outcome).toBe('KEPT_ACTIVE');
      expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', suspendedAt: null });
    });

    it('expired com vencimento há 23 h mantém; há 25 h corta', async () => {
      makeTenant();
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'EXPIRED', expiresAt: iso(-23 / 24) })]));
      expect((await run(ev('subscription.expired', { payload: {} }))).outcome).toBe('KEPT_ACTIVE');
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'EXPIRED', expiresAt: iso(-25 / 24) })]));
      expect((await run(ev('subscription.expired', { eventId: 'ev-exp-2', seq: 12n, payload: {} }))).outcome).toBe('APPLIED');
      expect(db.state.tenant!.status).toBe('CANCELLED');
    });

    it('cancelamento de admin na central (CANCELED/canceledAt) corta na hora mesmo com vencimento futuro', async () => {
      makeTenant();
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'CANCELED', expiresAt: iso(20) }), hubSub({ id: 's2', canceledAt: iso(-0.1), expiresAt: iso(20) })]));
      expect((await run(ev('subscription.canceled', { payload: {} }))).outcome).toBe('APPLIED');
      expect(db.state.tenant!.status).toBe('CANCELLED');
    });

    it.each(['unauthorized', 'timeout', 'http_error', 'network'])('central fora (%s): HUB_UNAVAILABLE sem recibo nem efeito', async (reason) => {
      makeTenant();
      hub.fetchByCustomer.mockResolvedValue({ ok: false, reason });
      expect(await run(ev('subscription.expired', { payload: {} }))).toEqual({ outcome: 'HUB_UNAVAILABLE', reason });
      expect(db.state.receipts.size).toBe(0);
      expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', lastBillingEventSeq: 10n });
      expect(db.txOptions).toHaveLength(0);
    });

    it('duplicado e tenant inexistente não consultam a central', async () => {
      makeTenant();
      db.state.receipts.set('ev-subscription.canceled', { outcome: 'APPLIED', tenantId: 'tenant-1', type: 'subscription.canceled' });
      expect((await run(ev('subscription.canceled'))).outcome).toBe('DUPLICATE');
      db.state.tenant = null;
      expect((await run(ev('subscription.expired'))).outcome).toBe('IGNORED');
      expect(hub.fetchByCustomer).not.toHaveBeenCalled();
    });

    it('payment_failed dentro da tolerância (vencida há 2 h) mantém ACTIVE', async () => {
      makeTenant();
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'PAYMENT_FAILED', expiresAt: iso(-2 / 24) })]));
      expect((await run(ev('subscription.payment_failed', { payload: {} }))).outcome).toBe('KEPT_ACTIVE');
      expect(db.state.tenant!.status).toBe('ACTIVE');
      expect(emit).not.toHaveBeenCalled();
    });

    it('bloqueio do super-admin vence: ativação e KEPT_ACTIVE só atualizam plano/vencimento; corte não mexe no status', async () => {
      const blockedAt = new Date('2026-10-01');
      makeTenant({ status: 'CANCELLED', suspendedAt: blockedAt, adminBlockedAt: blockedAt });
      await run(ev('subscription.renewed', { payload: { planSlug: 'COPYSYNC_MAX', expiresAt: iso(30) } }));
      expect(db.state.tenant).toMatchObject({ status: 'CANCELLED', suspendedAt: blockedAt, planSlug: 'COPYSYNC_MAX' });
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ expiresAt: iso(30) })]));
      expect((await run(ev('subscription.expired', { eventId: 'ev-k', seq: 12n, payload: {} }))).outcome).toBe('KEPT_ACTIVE');
      expect(db.state.tenant).toMatchObject({ status: 'CANCELLED', suspendedAt: blockedAt, planSlug: 'COPYSYNC_PRO' });
      db.state.tenant!.status = 'SUSPENDED';
      hub.fetchByCustomer.mockResolvedValue(hubOk([hubSub({ billingStatus: 'REFUNDED' })]));
      await run(ev('subscription.refunded', { eventId: 'ev-r', seq: 13n, payload: {} }));
      expect(db.state.tenant).toMatchObject({ status: 'SUSPENDED', suspendedAt: blockedAt, lastBillingEventSeq: 13n });
      expect(emit).not.toHaveBeenCalled();
    });

    it('corte de tenant já não-ACTIVE não regrava suspendedAt nem reemite', async () => {
      const since = new Date('2026-10-01');
      makeTenant({ status: 'SUSPENDED', suspendedAt: since });
      await run(ev('subscription.canceled', { payload: {} }));
      expect(db.state.tenant).toMatchObject({ status: 'CANCELLED', suspendedAt: since });
      expect(emit).not.toHaveBeenCalled();
    });

    it('falha persistente (401/404/invalid_response) = error; transitória = warn; contador por motivo', async () => {
      expect(classifyHubLookupFailure('unauthorized', 401)).toEqual({ key: 'unauthorized', persistent: true });
      expect(classifyHubLookupFailure('invalid_response', 200)).toEqual({ key: 'invalid_response', persistent: true });
      expect(classifyHubLookupFailure('http_error', 404)).toEqual({ key: 'http_error_404', persistent: true });
      expect(classifyHubLookupFailure('http_error', 503)).toEqual({ key: 'http_error', persistent: false });
      expect(classifyHubLookupFailure('timeout')).toEqual({ key: 'timeout', persistent: false });
      makeTenant();
      const before = hubLookupFailureCounts()['http_error_404'] ?? 0;
      hub.fetchByCustomer.mockResolvedValue({ ok: false, reason: 'http_error', status: 404 });
      expect((await run(ev('subscription.expired', { payload: {} }))).outcome).toBe('HUB_UNAVAILABLE');
      expect((await run(ev('subscription.expired', { payload: {} }))).outcome).toBe('HUB_UNAVAILABLE');
      expect(hubLookupFailureCounts()['http_error_404']).toBe(before + 2);
      expect(db.state.receipts.size).toBe(0);
    });

    it('renovação segue sem consultar a central', async () => {
      makeTenant();
      await run(ev('subscription.renewed'));
      expect(hub.fetchByCustomer).not.toHaveBeenCalled();
    });
  });

  it('fim de trial não muda a conta, grava IGNORED e avança a marca d’água', async () => {
    makeTenant();
    expect((await run(ev('subscription.trial_ended'))).outcome).toBe('IGNORED');
    expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_LITE', lastBillingEventSeq: 11n });
  });

  it('tipo desconhecido grava IGNORED sem erro e avança a marca d’água', async () => {
    makeTenant();
    expect((await run(ev('invoice.created'))).outcome).toBe('IGNORED');
    expect(db.state.receipts.get('ev-invoice.created')).toMatchObject({ outcome: 'IGNORED', type: 'invoice.created' });
    expect(db.state.tenant!.lastBillingEventSeq).toBe(11n);
  });

  it('seq acima de 2^53 compara e avança a marca d’água sem perder precisão', async () => {
    makeTenant({ lastBillingEventSeq: 9_007_199_254_740_992n });
    expect((await run(ev('subscription.renewed', { eventId: 'ev-big', seq: 9_007_199_254_740_993n }))).outcome).toBe('APPLIED');
    expect(db.state.tenant!.lastBillingEventSeq).toBe(9_007_199_254_740_993n);
    expect((await run(ev('subscription.canceled', { eventId: 'ev-big-old', seq: 9_007_199_254_740_993n }))).outcome).toBe('OUT_OF_ORDER');
  });

  it('tipo desconhecido com seq antigo vira OUT_OF_ORDER', async () => {
    makeTenant();
    expect((await run(ev('invoice.created', { seq: 9n }))).outcome).toBe('OUT_OF_ORDER');
    expect(db.state.tenant!.lastBillingEventSeq).toBe(10n);
  });

  it('cliente desconhecido em evento que não é ativação grava IGNORED', async () => {
    expect((await run(ev('subscription.renewed'))).outcome).toBe('IGNORED');
    expect(provisioner.execute).not.toHaveBeenCalled();
    expect(db.state.receipts.get('ev-subscription.renewed')?.outcome).toBe('IGNORED');
  });

  it('ativação de cliente já conhecido não provisiona de novo', async () => {
    makeTenant({ status: 'SUSPENDED' });
    await run(ev('subscription.activated'));
    expect(provisioner.execute).not.toHaveBeenCalled();
    expect(db.state.tenant).toMatchObject({ status: 'ACTIVE', planSlug: 'COPYSYNC_PRO' });
  });

  it('ativação concorrente que já criou o tenant (P2002) segue com ele', async () => {
    provisioner.execute.mockImplementation(async () => {
      makeTenant({ lastBillingEventSeq: null });
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['billingCustomerId'] } });
    });
    expect((await run(ev('subscription.activated'))).outcome).toBe('APPLIED');
  });

  describe('vencimento (expiresAt)', () => {
    const PREV = new Date('2026-11-01T00:00:00Z');

    it('renovação com data grava o vencimento', async () => {
      makeTenant({ subscriptionExpiresAt: PREV });
      await run(ev('subscription.renewed', { payload: { planSlug: 'COPYSYNC_PRO', expiresAt: '2026-12-04T15:00:00.000Z' } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toEqual(new Date('2026-12-04T15:00:00.000Z'));
    });

    it.each(['subscription.activated', 'subscription.updated'])('%s com data grava mesmo sem plano válido', async (type) => {
      makeTenant();
      await run(ev(type, { payload: { planSlug: 'gold', expiresAt: '2027-01-10T00:00:00.000Z' } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toEqual(new Date('2027-01-10T00:00:00.000Z'));
    });

    it('falha de pagamento preserva o vencimento gravado', async () => {
      makeTenant({ subscriptionExpiresAt: PREV });
      await run(ev('subscription.payment_failed', { payload: { expiresAt: '2030-01-01T00:00:00.000Z' } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toBe(PREV);
    });

    it('cancelamento preserva o vencimento gravado', async () => {
      makeTenant({ subscriptionExpiresAt: PREV });
      await run(ev('subscription.canceled', { payload: { expiresAt: null } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toBe(PREV);
    });

    it.each(['não-é-data', ''])('data malformada %j mantém o vencimento gravado (nunca vira null)', async (bad) => {
      makeTenant({ subscriptionExpiresAt: PREV });
      await run(ev('subscription.renewed', { payload: { planSlug: 'COPYSYNC_PRO', expiresAt: bad } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toBe(PREV);
    });

    it('null explícito limpa; ausente mantém', async () => {
      makeTenant({ subscriptionExpiresAt: PREV });
      await run(ev('subscription.updated', { payload: { planSlug: 'COPYSYNC_PRO' } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toBe(PREV);
      await run(ev('subscription.updated', { eventId: 'ev-2', seq: 12n, payload: { planSlug: 'COPYSYNC_PRO', expiresAt: null } }));
      expect(db.state.tenant!.subscriptionExpiresAt).toBeNull();
    });
  });
  describe('vínculo pelo e-mail do dono (tenant criado sem billingCustomerId)', () => {
    const manual = (id: string, billingCustomerId: string | null = null) => {
      db.state.others.set(id, { id, status: 'ACTIVE', lastBillingEventSeq: null, planSlug: null, suspendedAt: null, billingCustomerId });
    };
    const own = (tenantId: string, role = 'ADMIN', userId = 'u-ana') => {
      db.state.users.set('ana@exemplo.com', userId);
      db.state.memberships.push({ userId, tenantId, role });
    };
    const activated = (over: Partial<ApplyBillingEventInput> = {}) =>
      ev('subscription.activated', { payload: { email: '  Ana@Exemplo.com ', name: 'Ana', planSlug: 'COPYSYNC_PRO' }, ...over });

    it('dono de um único tenant sem cliente: vincula, aplica o plano e audita, sem provisionar', async () => {
      manual('t-manual');
      own('t-manual');
      const out = await run(activated());
      expect(provisioner.execute).not.toHaveBeenCalled();
      expect(out).toEqual({ outcome: 'APPLIED', tenantId: 't-manual' });
      expect(db.state.tenant).toMatchObject({ id: 't-manual', billingCustomerId: 'user-central-1', planSlug: 'COPYSYNC_PRO', lastBillingEventSeq: 11n });
      expect(db.state.entitlements.get('whatsapp_sessions')).toBe('1');
      expect(db.state.receipts.get('ev-subscription.activated')).toMatchObject({ outcome: 'APPLIED', tenantId: 't-manual' });
      expect(db.state.audits).toEqual([expect.objectContaining({
        tenantId: 't-manual', action: 'TENANT_UPDATED',
        meta: expect.objectContaining({ change: 'billing_customer_linked', billingCustomerId: 'user-central-1', ownerUserId: 'u-ana' }),
      })]);
    });

    it('reentrega do mesmo evento é DUPLICATE e eventos seguintes acham pelo cliente', async () => {
      manual('t-manual');
      own('t-manual');
      await run(activated());
      expect((await run(activated())).outcome).toBe('DUPLICATE');
      const renewed = await run(ev('subscription.renewed', { seq: 12n, payload: { planSlug: 'COPYSYNC_MAX' } }));
      expect(renewed).toEqual({ outcome: 'APPLIED', tenantId: 't-manual' });
      expect(db.state.tenant).toMatchObject({ id: 't-manual', planSlug: 'COPYSYNC_MAX', lastBillingEventSeq: 12n });
      expect(provisioner.execute).not.toHaveBeenCalled();
      expect(db.state.audits).toHaveLength(1);
    });

    it('dois tenants elegíveis: provisiona um novo como antes e não toca nos dois', async () => {
      manual('t-a');
      manual('t-b');
      own('t-a');
      own('t-b');
      await run(activated());
      expect(provisioner.execute).toHaveBeenCalledTimes(1);
      expect(db.state.others.get('t-a')!.billingCustomerId).toBeNull();
      expect(db.state.others.get('t-b')!.billingCustomerId).toBeNull();
      expect(db.state.audits).toHaveLength(0);
    });

    it('tenant do dono já ligado a outro cliente não é tocado: provisiona', async () => {
      manual('t-outro', 'outro-cliente');
      own('t-outro');
      await run(activated());
      expect(provisioner.execute).toHaveBeenCalledTimes(1);
      expect(db.state.others.get('t-outro')!.billingCustomerId).toBe('outro-cliente');
    });

    it('um tenant sem cliente e outro já vinculado: ambíguo, provisiona', async () => {
      manual('t-livre');
      manual('t-outro', 'outro-cliente');
      own('t-livre');
      own('t-outro');
      await run(activated());
      expect(provisioner.execute).toHaveBeenCalledTimes(1);
      expect(db.state.others.get('t-livre')!.billingCustomerId).toBeNull();
    });

    it('usuário só OPERATOR do tenant não vincula: provisiona', async () => {
      manual('t-manual');
      own('t-manual', 'OPERATOR');
      await run(activated());
      expect(provisioner.execute).toHaveBeenCalledTimes(1);
      expect(db.state.others.get('t-manual')!.billingCustomerId).toBeNull();
    });

    it('candidato vinculado por outro cliente antes do lock: erro sem recibo (hub reenvia)', async () => {
      manual('t-manual');
      own('t-manual');
      db.state.candidateGone = true;
      await expect(run(activated())).rejects.toThrow();
      expect(db.state.receipts.size).toBe(0);
      expect(db.state.audits).toHaveLength(0);
    });

    it('evento que não é ativação não vincula', async () => {
      manual('t-manual');
      own('t-manual');
      expect((await run(ev('subscription.renewed'))).outcome).toBe('IGNORED');
      expect(db.state.others.get('t-manual')!.billingCustomerId).toBeNull();
    });
  });
});
