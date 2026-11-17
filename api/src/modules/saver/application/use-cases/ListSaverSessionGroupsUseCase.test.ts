import { describe, expect, it, vi } from 'vitest';
import { ListSaverSessionGroupsUseCase } from './ListSaverSessionGroupsUseCase';
import { actorOf, savedGroup, sessionRef } from './saverUseCaseFakes';
import type { SaverSessionRef } from '../../domain/contracts/ISaverSessionReader';
import { SaverExtractionItemStatus } from '../../domain/enums/SaverEnums';

const SCANNED = new Date('2026-11-16T10:00:00Z');

function make(session: SaverSessionRef | null = sessionRef()) {
  const engine = {
    listParticipatingGroups: vi.fn(async () => [
      { groupJid: '111@g.us', name: 'Um', memberCount: 12 },
      { groupJid: '222', name: null, memberCount: null, kind: 'COMMUNITY' as const },
      { groupJid: '333', name: 'Três', kind: 'COMMUNITY_ANNOUNCE' as const, memberCount: 900 },
    ]),
  };
  const deps = {
    sessions: { findById: vi.fn(async (t: string) => (t === 't1' ? session : null)) },
    groups: {
      findByJids: vi.fn(async () => [
        savedGroup({ id: 'g1', groupJid: '111', lastScannedAt: SCANNED, lastScanStatus: SaverExtractionItemStatus.DONE }),
        savedGroup({ id: 'g2', groupJid: '222', name: 'Dois salvo' }),
        savedGroup({ id: 'g3', groupJid: '333', removedAt: SCANNED }),
      ]),
    },
    engine: () => engine,
  };
  return { deps, engine, uc: new ListSaverSessionGroupsUseCase(deps) };
}

describe('ListSaverSessionGroupsUseCase', () => {
  it('lista grupos e marca salvos com a última leitura (removido não conta)', async () => {
    const { uc, deps } = make();
    const r = await uc.execute(actorOf('OPERATOR'), { sessionId: 's1' });
    expect(deps.groups.findByJids).toHaveBeenCalledWith('t1', ['111', '222', '333']);
    expect(r).toEqual([
      { groupJid: '111', name: 'Um', saved: true, savedGroupId: 'g1', lastScannedAt: SCANNED, lastScanStatus: 'DONE',
        memberCount: 12, kind: 'GROUP', selectable: true, unselectableReason: null },
      { groupJid: '222', name: 'Dois salvo', saved: true, savedGroupId: 'g2', lastScannedAt: null, lastScanStatus: null,
        memberCount: null, kind: 'COMMUNITY', selectable: false, unselectableReason: 'COMMUNITY_PARENT' },
      { groupJid: '333', name: 'Três', saved: false, savedGroupId: null, lastScannedAt: null, lastScanStatus: null,
        memberCount: 900, kind: 'COMMUNITY_ANNOUNCE', selectable: true, unselectableReason: null },
    ]);
  });

  it('sessão de outro tenant → não encontrada, sem chamar o engine', async () => {
    const { uc, engine } = make();
    await expect(uc.execute(actorOf('ADMIN', 't2'), { sessionId: 's1' })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(engine.listParticipatingGroups).not.toHaveBeenCalled();
  });

  it('Telegram → ENGINE_OPERATION_UNSUPPORTED', async () => {
    const { uc, engine } = make(sessionRef({ engine: 'telegram' }));
    await expect(uc.execute(actorOf('ADMIN'), { sessionId: 's1' })).rejects.toMatchObject({ code: 'ENGINE_OPERATION_UNSUPPORTED' });
    expect(engine.listParticipatingGroups).not.toHaveBeenCalled();
  });

  it('desconectada → SESSION_NOT_CONNECTED', async () => {
    const { uc } = make(sessionRef({ status: 'DISCONNECTED' }));
    await expect(uc.execute(actorOf('ADMIN'), { sessionId: 's1' })).rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED' });
  });
});
