import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CloseOrphanSaverExtractionsUseCase } from './CloseOrphanSaverExtractionsUseCase';
import { ProcessNextSaverItemUseCase } from './ProcessNextSaverItemUseCase';
import { makeSaverStepHarness, member } from './saverTestFakes';
import { SaverExtractionItemStatus as I, SaverExtractionStatus as E } from '../../domain/enums/SaverEnums';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const T = 'tenant-a';

function setup() {
  const h = makeSaverStepHarness();
  h.activeTenants.add(T);
  h.entitlements.set(T, { saver_contacts: null });
  h.groups.add('g1', T);
  h.groups.add('g2', T);
  return h;
}

describe('CloseOrphanSaverExtractionsUseCase', () => {
  it('cancela itens pendentes de sessão excluída e outra sessão relê o mesmo grupo', async () => {
    const h = setup();
    h.queue.addItem({ id: 'i1', sessionId: 'old', tenantId: T, groupId: 'g1' });
    h.queue.addItem({ id: 'i2', sessionId: 'old', tenantId: T, groupId: 'g2', status: I.RUNNING, lockedUntil: new Date(NOW.getTime() + 60_000) });
    h.queue.deletedSessions.add('old');

    const r = await new CloseOrphanSaverExtractionsUseCase(h).execute({ now: NOW });
    expect(r.cancelledItems).toBe(2);
    expect(h.queue.items.map((i) => i.status)).toEqual([I.CANCELLED, I.CANCELLED]);
    expect(h.queue.extractions[0]!.status).toBe(E.CANCELLED);

    // Nenhum item pendente no grupo: outra sessão relê
    h.queue.addItem({ id: 'i3', extractionId: 'ext-2', sessionId: 'new', tenantId: T, groupId: 'g1' });
    h.reads.set('g1@g.us', [member('551100001')]);
    await new ProcessNextSaverItemUseCase(h.deps).execute({ localSessionIds: ['new'], now: NOW });
    expect(h.queue.items.find((i) => i.id === 'i3')!.status).toBe(I.DONE);
  });

  it('extração órfã com algum item concluído fecha PARTIAL', async () => {
    const h = setup();
    h.queue.addItem({ id: 'i1', sessionId: 'old', tenantId: T, groupId: 'g1', status: I.DONE });
    h.queue.addItem({ id: 'i2', sessionId: 'old', tenantId: T, groupId: 'g2' });
    h.queue.deletedSessions.add('old');
    await new CloseOrphanSaverExtractionsUseCase(h).execute({ now: NOW });
    expect(h.queue.extractions[0]).toMatchObject({ status: E.PARTIAL, finishedAt: NOW });
  });

  it('extração com item pendente de sessão viva não é tocada', async () => {
    const h = setup();
    h.queue.addItem({ id: 'i1', sessionId: 'live', tenantId: T, groupId: 'g1' });
    const r = await new CloseOrphanSaverExtractionsUseCase(h).execute({ now: NOW });
    expect(r.processed).toBe(0);
    expect(h.queue.items[0]!.status).toBe(I.QUEUED);
    expect(h.queue.extractions[0]).toMatchObject({ status: E.QUEUED, finishedAt: null });
  });

  it('extração aberta sem item pendente (ex.: reinício no meio) é fechada', async () => {
    const h = setup();
    h.queue.addItem({ id: 'i1', sessionId: 'live', tenantId: T, groupId: 'g1', status: I.FAILED });
    const r = await new CloseOrphanSaverExtractionsUseCase(h).execute({ now: NOW });
    expect(r.closedExtractions).toBe(1);
    expect(h.queue.extractions[0]!.status).toBe(E.FAILED);
  });

  it('nunca apaga contato nem vínculo', async () => {
    const h = setup();
    h.store.contacts.push({ id: 'c1', phone: '551100001', lid: null, name: null, firstSeenAt: NOW, lastSeenAt: NOW });
    h.store.links.push({ tenantId: T, groupId: 'g1', contactId: 'c1', leftAt: null });
    h.queue.addItem({ id: 'i1', sessionId: 'old', tenantId: T, groupId: 'g1' });
    h.queue.deletedSessions.add('old');
    await new CloseOrphanSaverExtractionsUseCase(h).execute({ now: NOW });
    expect(h.store.contacts).toHaveLength(1);
    expect(h.store.links).toHaveLength(1);
  });

  it('manutenção e fila não têm DELETE em saver_contacts', () => {
    for (const file of ['./CloseOrphanSaverExtractionsUseCase.ts', '../../infrastructure/repositories/PrismaSaverExtractionQueue.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).not.toMatch(/DELETE\s+FROM\s+"saver_contacts"|saverContact\.delete/i);
    }
  });
});
