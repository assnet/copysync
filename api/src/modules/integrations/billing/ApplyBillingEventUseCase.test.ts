import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/** Banco em memória: tenant único por `billingCustomerId`, recibos por `eventId`. */
const db = vi.hoisted(() => {
  type Tenant = { id: string; status: string; lastBillingEventSeq: bigint | null; planSlug: string | null; suspendedAt: Date | null; subscriptionExpiresAt?: Date | null };
  const state = {
    tenant: null as Tenant | null,
    receipts: new Map<string, { outcome: string; tenantId: string | null; type: string }>(),
    entitlements: new Map<string, unknown>(),
    locked: 0,
    /** Força P2002 no create do recibo (outra requisição gravou o mesmo eventId). */
    receiptRace: false,
  };
  const client = {
    $queryRaw: async () => {
      state.locked++;
      return state.tenant ? [{ id: state.tenant.id, status: state.tenant.status, lastBillingEventSeq: state.tenant.lastBillingEventSeq }] : [];
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
      findUnique: async () => (state.tenant ? { id: state.tenant.id } : null),
      update: async ({ data }: { data: Partial<Tenant> }) => { Object.assign(state.tenant!, data); return {}; },
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

import { ApplyBillingEventUseCase, type ApplyBillingEventInput } from './ApplyBillingEventUseCase';
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

beforeEach(() => {
  db.state.tenant = null;
  db.state.receipts.clear();
  db.state.entitlements.clear();
  db.state.locked = 0;
  db.state.receiptRace = false;
  db.txOptions.length = 0;
  provisioner.execute.mockReset();
  provisioner.execute.mockImplementation(async () => {
    makeTenant({ lastBillingEventSeq: null, planSlug: 'COPYSYNC_PRO' });
    return { tenantId: 'tenant-1', userId: 'u1', inviteLink: null, emailSent: false, existingAccount: false };
  });
});

const run = (input: ApplyBillingEventInput) => new ApplyBillingEventUseCase(provisioner).execute(input);

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

  it('falha de pagamento suspende e emite TENANT_SUSPENDED depois do commit', async () => {
    makeTenant();
    const out = await run(ev('subscription.payment_failed', { payload: {} }));
    expect(out.outcome).toBe('APPLIED');
    expect(db.state.tenant!.status).toBe('SUSPENDED');
    expect(db.state.tenant!.suspendedAt).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: 'tenant-1' });
  });

  it.each(['subscription.canceled', 'subscription.expired', 'subscription.refunded', 'subscription.chargedback'])(
    '%s cancela a conta e emite TENANT_SUSPENDED',
    async (type) => {
      makeTenant();
      await run(ev(type, { payload: {} }));
      expect(db.state.tenant!.status).toBe('CANCELLED');
      expect(emit).toHaveBeenCalledTimes(1);
    },
  );

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
});
