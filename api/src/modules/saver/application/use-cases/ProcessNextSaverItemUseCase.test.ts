import { describe, expect, it } from 'vitest';
import {
  ProcessNextSaverItemUseCase,
  SAVER_DISCONNECTED_RETRY_MS,
  SAVER_PAUSE_MS,
} from './ProcessNextSaverItemUseCase';
import { makeSaverStepHarness, member, type SaverStepHarness } from './saverTestFakes';
import { SaverExtractionItemStatus as I, SaverExtractionStatus as E } from '../../domain/enums/SaverEnums';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import {
  EngineOperationUnsupportedError,
  EngineRateLimitedError,
  EngineTemporarilyUnavailableError,
} from '../../../../shared/errors/internal/MessagingErrors';
import { ConcurrentWriteConflictError } from '../../../../shared/errors/internal/ResourceErrors';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const T = 'tenant-a';
const S = 'sess-1';

function setup(random?: () => number): SaverStepHarness {
  const h = makeSaverStepHarness(random);
  h.activeTenants.add(T);
  h.entitlements.set(T, { saver_contacts: null });
  h.groups.add('g1', T);
  h.queue.addItem({ id: 'i1', sessionId: S, tenantId: T, groupId: 'g1' });
  return h;
}

const run = (h: SaverStepHarness, now = NOW, local = [S]) =>
  new ProcessNextSaverItemUseCase(h.deps).execute({ localSessionIds: local, now });

const item = (h: SaverStepHarness, id = 'i1') => h.queue.items.find((i) => i.id === id)!;
const extraction = (h: SaverStepHarness, id = 'ext-1') => h.queue.extractions.find((e) => e.id === id)!;

describe('ProcessNextSaverItemUseCase', () => {
  it('lê o grupo, grava e fecha a extração DONE com contadores', async () => {
    const h = setup();
    h.reads.set('g1@g.us', [member('5511999990001', null, 'Ana'), member(null, '777'), member('5511999990002')]);
    const r = await run(h);
    expect(r.outcomes).toEqual([{ sessionId: S, itemId: 'i1', outcome: 'DONE' }]);
    expect(item(h).status).toBe(I.DONE);
    expect(h.store.contacts).toHaveLength(3);
    expect(extraction(h)).toMatchObject({ status: E.DONE, membersFound: 3, newContacts: 3, doneGroups: 1 });
    expect(h.groups.scans[0]!.scan).toMatchObject({ status: I.DONE, memberCount: 3, phoneCount: 2, lidOnlyCount: 1 });
  });

  it('ritmo: próxima leitura da sessão entre 3 e 5 s (sorteio fixo)', async () => {
    const low = setup(() => 0);
    await run(low);
    expect(low.states.states.get(S)!.nextScanAt).toEqual(at(3_000));
    const high = setup(() => 0.9999999);
    await run(high);
    expect(high.states.states.get(S)!.nextScanAt).toEqual(at(5_000));
    // Antes do horário a sessão não é processada de novo
    high.queue.addItem({ id: 'i2', sessionId: S, tenantId: T, groupId: 'g1' });
    expect((await run(high, at(4_000))).processed).toBe(0);
    expect((await run(high, at(5_000))).processed).toBe(1);
  });

  it('sessão alheia (fora das sessões do processo) é ignorada', async () => {
    const h = setup();
    h.queue.addItem({ id: 'i2', sessionId: 'sess-outro', tenantId: T, groupId: 'g1' });
    await run(h, NOW, [S]);
    expect(h.engineCalls.map((c) => c.sessionId)).toEqual([S]);
    expect(item(h, 'i2').status).toBe(I.QUEUED);
  });

  it('sessão desconectada devolve o item sem contar tentativa', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new SessionNotConnectedError(S));
    const r = await run(h);
    expect(r.outcomes[0]!.outcome).toBe('DISCONNECTED');
    expect(item(h)).toMatchObject({ status: I.QUEUED, attempts: 0, nextAttemptAt: at(SAVER_DISCONNECTED_RETRY_MS) });
  });

  it('limite de taxa pausa a sessão 15 min sem contar tentativa', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new EngineRateLimitedError());
    await run(h);
    expect(h.states.states.get(S)).toMatchObject({ pausedUntil: at(SAVER_PAUSE_MS), pauseReason: 'ENGINE_RATE_LIMITED' });
    expect(item(h)).toMatchObject({ status: I.QUEUED, attempts: 0 });
    // Pausada: nem antes do fim da pausa a sessão volta
    expect((await run(h, at(SAVER_PAUSE_MS - 1))).processed).toBe(0);
  });

  it('engine indisponível pausa a sessão e conta tentativa (teto contra pausa eterna)', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new EngineTemporarilyUnavailableError());
    await run(h);
    expect(h.states.states.get(S)!.pausedUntil).toEqual(at(SAVER_PAUSE_MS));
    expect(item(h)).toMatchObject({ status: I.QUEUED, attempts: 1 });
  });

  it('3 falhas → FAILED e extração FAILED', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new Error('boom'));
    let now = NOW;
    for (let n = 0; n < 3; n++) {
      await run(h, now);
      now = new Date(Math.max(item(h).nextAttemptAt.getTime(), h.states.states.get(S)!.nextScanAt.getTime()));
    }
    expect(item(h)).toMatchObject({ status: I.FAILED, attempts: 3, errorCode: 'UNEXPECTED' });
    expect(extraction(h).status).toBe(E.FAILED);
    expect(h.engineCalls).toHaveLength(3);
  });

  it('grupo sem acesso (operação não suportada) falha de vez', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new EngineOperationUnsupportedError('telegram', 'getGroupMembers'));
    await run(h);
    expect(item(h).status).toBe(I.FAILED);
  });

  it('corrida com outro tenant na gravação: repete sem contar tentativa', async () => {
    const h = setup();
    h.reads.set('g1@g.us', [member('5511999990001')]);
    h.store.applyError = new ConcurrentWriteConflictError('SaverContact');
    const r = await run(h);
    expect(r.outcomes[0]!.outcome).toBe('CONFLICT');
    expect(item(h)).toMatchObject({ status: I.QUEUED, attempts: 0, errorCode: 'CONCURRENT_WRITE_CONFLICT' });
    await run(h, at(10_000));
    expect(item(h).status).toBe(I.DONE);
  });

  describe('teto saver_contacts', () => {
    it('não grava pela metade quando a leitura passa do teto', async () => {
      const h = setup();
      h.entitlements.set(T, { saver_contacts: 2 });
      h.reads.set('g1@g.us', [member('551100001'), member('551100002'), member('551100003')]);
      await run(h);
      expect(h.store.applied).toBe(0);
      expect(h.store.contacts).toHaveLength(0);
      expect(item(h)).toMatchObject({ status: I.FAILED, errorCode: 'PLAN_LIMIT_REACHED' });
    });

    it('chave ausente = 0 (não grava)', async () => {
      const h = setup();
      h.entitlements.set(T, {});
      h.reads.set('g1@g.us', [member('551100001')]);
      await run(h);
      expect(item(h).status).toBe(I.FAILED);
    });

    it('contato já vinculado ao tenant não consome; já na base por outro tenant consome no primeiro vínculo', async () => {
      const h = setup();
      h.entitlements.set(T, { saver_contacts: 2 });
      // Base: c-a já vinculado ao tenant (outro grupo); c-b só de outro tenant
      h.groups.add('g0', T);
      h.groups.add('gx', 'tenant-b');
      h.store.contacts.push(
        { id: 'c-a', phone: '551100001', lid: null, name: null, firstSeenAt: NOW, lastSeenAt: NOW },
        { id: 'c-b', phone: '551100002', lid: null, name: null, firstSeenAt: NOW, lastSeenAt: NOW },
      );
      h.store.links.push(
        { tenantId: T, groupId: 'g0', contactId: 'c-a', leftAt: null },
        { tenantId: 'tenant-b', groupId: 'gx', contactId: 'c-b', leftAt: null },
      );
      // usados = 1 (c-a); leitura: c-a (não consome) + c-b (consome) = 2 → cabe
      h.reads.set('g1@g.us', [member('551100001'), member('551100002')]);
      await run(h);
      expect(item(h).status).toBe(I.DONE);
      expect(extraction(h).newContacts).toBe(0);

      // Mais um contato novo passaria de 2
      h.groups.add('g2', T);
      h.queue.addItem({ id: 'i2', extractionId: 'ext-2', sessionId: S, tenantId: T, groupId: 'g2' });
      h.reads.set('g2@g.us', [member('551100003')]);
      await run(h, at(10_000));
      expect(item(h, 'i2')).toMatchObject({ status: I.FAILED, errorCode: 'PLAN_LIMIT_REACHED' });
    });
  });

  it('produto SAVER inativo cancela os itens do tenant e não lê o grupo', async () => {
    const h = setup();
    h.activeTenants.clear();
    h.queue.addItem({ id: 'i2', sessionId: S, tenantId: T, groupId: 'g1' });
    const r = await run(h);
    expect(r.outcomes[0]!.outcome).toBe('PRODUCT_INACTIVE');
    expect(h.engineCalls).toHaveLength(0);
    expect(h.queue.items.map((i) => i.status)).toEqual([I.CANCELLED, I.CANCELLED]);
    expect(extraction(h).status).toBe(E.CANCELLED);
  });

  it('falha ao ler o acesso devolve o item sem decidir nem contar tentativa', async () => {
    const h = setup();
    h.productError = new Error('db down');
    await run(h);
    expect(item(h)).toMatchObject({ status: I.QUEUED, attempts: 0 });
    expect(h.engineCalls).toHaveLength(0);
  });

  it('grupo removido cancela o item sem ler', async () => {
    const h = setup();
    h.groups.groups[0]!.removedAt = NOW;
    await run(h);
    expect(item(h).status).toBe(I.CANCELLED);
    expect(h.engineCalls).toHaveLength(0);
  });

  it('grupo removido durante a leitura: nada gravado, item segue CANCELLED e o grupo não volta', async () => {
    const h = setup();
    h.reads.set('g1@g.us', [member('5511999990001')]);
    h.duringRead = async () => {
      await h.queue.cancelPendingByGroup(T, 'g1', NOW);
      await h.groups.markRemoved(T, 'g1', NOW);
    };
    const r = await run(h);
    expect(r.outcomes[0]!.outcome).toBe('CANCELLED');
    expect(item(h).status).toBe(I.CANCELLED);
    expect(h.store.links).toHaveLength(0);
    expect(h.groups.scans).toHaveLength(0);
    expect(extraction(h)).toMatchObject({ status: E.CANCELLED, doneGroups: 0, membersFound: 0 });
    expect(h.groups.groups[0]!.removedAt).not.toBeNull();
  });

  it('erro depois de cancelado: o reagendamento não ressuscita o item', async () => {
    const h = setup();
    h.reads.set('g1@g.us', new SessionNotConnectedError(S));
    h.duringRead = async () => {
      await h.queue.cancelPendingByGroup(T, 'g1', NOW);
    };
    await run(h);
    expect(item(h).status).toBe(I.CANCELLED);
  });

  it('fechamento: um DONE e um FAILED → PARTIAL', async () => {
    const h = setup();
    h.groups.add('g2', T);
    h.queue.addItem({ id: 'i2', sessionId: S, tenantId: T, groupId: 'g2' });
    h.reads.set('g1@g.us', [member('551100001')]);
    h.reads.set('g2@g.us', new EngineOperationUnsupportedError('x', 'y'));
    await run(h);
    expect(extraction(h).finishedAt).toBeNull();
    await run(h, at(10_000));
    expect(extraction(h)).toMatchObject({ status: E.PARTIAL, doneGroups: 1, failedGroups: 1 });
  });

  it('leitura vazia não marca saída de ninguém', async () => {
    const h = setup();
    h.reads.set('g1@g.us', [member('551100001')]);
    await run(h);
    h.queue.addItem({ id: 'i2', extractionId: 'ext-2', sessionId: S, tenantId: T, groupId: 'g1' });
    h.reads.set('g1@g.us', []);
    await run(h, at(10_000));
    expect(item(h, 'i2').status).toBe(I.DONE);
    expect(h.store.links.every((l) => l.leftAt === null)).toBe(true);
  });
});
