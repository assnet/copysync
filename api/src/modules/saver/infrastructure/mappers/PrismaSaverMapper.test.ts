import { describe, expect, it } from 'vitest';
import { PrismaSaverMapper } from './PrismaSaverMapper';

const at = new Date('2026-11-17T12:00:00.000Z');

describe('PrismaSaverMapper', () => {
  it('config: formato desconhecido cai em CSV', () => {
    const row = { tenantId: 't', namePrefix: null, excludeAdminsByDefault: true, defaultFormat: 'XLS', autoRefresh: false, updatedAt: at };
    expect(PrismaSaverMapper.config(row).defaultFormat).toBe('CSV');
    expect(PrismaSaverMapper.config({ ...row, defaultFormat: 'VCARD' }).defaultFormat).toBe('VCARD');
  });

  it('grupo: status nulo fica nulo; desconhecido vira FAILED', () => {
    const row = {
      id: 'g', tenantId: 't', sessionId: null, groupJid: '1@g.us', name: 'G', memberCount: 3, phoneCount: 2, lidOnlyCount: 1,
      lastScannedAt: null, lastScanStatus: null, createdAt: at, removedAt: null,
    };
    expect(PrismaSaverMapper.group(row).lastScanStatus).toBeNull();
    expect(PrismaSaverMapper.group({ ...row, lastScanStatus: 'DONE' }).lastScanStatus).toBe('DONE');
    expect(PrismaSaverMapper.group({ ...row, lastScanStatus: '??' }).lastScanStatus).toBe('FAILED');
  });

  it('extração e item: enums preservados', () => {
    const ext = PrismaSaverMapper.extraction({
      id: 'e', tenantId: 't', sessionId: 's', requestedByUserId: 'u', trigger: 'AUTO', status: 'PARTIAL',
      totalGroups: 2, doneGroups: 1, failedGroups: 1, membersFound: 10, newContacts: 4, createdAt: at, finishedAt: at,
    });
    expect(ext).toMatchObject({ trigger: 'AUTO', status: 'PARTIAL', newContacts: 4 });
    const item = PrismaSaverMapper.item({
      id: 'i', extractionId: 'e', tenantId: 't', sessionId: 's', groupId: 'g', status: 'RUNNING', attempts: 1,
      nextAttemptAt: at, lockedUntil: at, errorCode: null, finishedAt: null, createdAt: at,
    });
    expect(item).toEqual({
      id: 'i', extractionId: 'e', tenantId: 't', sessionId: 's', groupId: 'g', status: 'RUNNING', attempts: 1,
      nextAttemptAt: at, lockedUntil: at, errorCode: null, finishedAt: null, createdAt: at,
    });
  });

  it('contato e liberação: campos copiados', () => {
    expect(PrismaSaverMapper.contact({ id: 'c', phone: '55', lid: null, name: null, firstSeenAt: at, lastSeenAt: at })).toEqual({
      id: 'c', phone: '55', lid: null, name: null, firstSeenAt: at, lastSeenAt: at,
    });
    expect(PrismaSaverMapper.grant({ id: 'x', tenantId: 't', userId: 'u', grantedByUserId: null, createdAt: at })).toMatchObject({ userId: 'u' });
  });
});
