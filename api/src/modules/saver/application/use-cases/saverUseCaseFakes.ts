// Fábricas de dados só para testes dos use cases do Saver.
import type { SaverGroup } from '../../domain/entities/SaverEntities';
import type { SaverSessionRef } from '../../domain/contracts/ISaverSessionReader';
import type { SaverActor } from './saverActor';

export const actorOf = (role: SaverActor['role'], tenantId = 't1'): SaverActor => ({ tenantId, userId: 'u1', role });

export const sessionRef = (over: Partial<SaverSessionRef> = {}): SaverSessionRef => ({
  id: 's1', status: 'CONNECTED', engine: 'baileys', ...over,
});

export const savedGroup = (over: Partial<SaverGroup> = {}): SaverGroup => ({
  id: 'g1', tenantId: 't1', sessionId: 's1', groupJid: '111', name: 'Grupo', memberCount: 0, phoneCount: 0,
  lidOnlyCount: 0, lastScannedAt: null, lastScanStatus: null, createdAt: new Date('2026-11-01T00:00:00Z'),
  removedAt: null, ...over,
});
