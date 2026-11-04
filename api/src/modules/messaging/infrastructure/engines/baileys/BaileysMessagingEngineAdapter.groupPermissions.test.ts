import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessagingEngineAdapter, baileysGroupPermissions } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';

vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
  releaseAuthState: async () => undefined,
  discardAuthState: async () => undefined,
}));

const S = 'sess-group-perms';
const user = { id: '5511999990000:3@s.whatsapp.net', lid: '777:3@lid' };

beforeEach(() => BaileysSessionRegistry.get().delete(S));

describe('baileysGroupPermissions', () => {
  it('grupo aberto, membro comum: posta, não convida', () => {
    expect(baileysGroupPermissions({ announce: false, participants: [{ id: '777@lid' }] }, user))
      .toEqual({ canPost: true, postBlockedReason: null, canInvite: false, inviteBlockedReason: 'NOT_ADMIN' });
  });

  it('só-admins e membro comum: ADMINS_ONLY', () => {
    expect(baileysGroupPermissions({ announce: true, participants: [{ id: '5511999990000@s.whatsapp.net' }] }, user))
      .toMatchObject({ canPost: false, postBlockedReason: 'ADMINS_ONLY' });
  });

  it('só-admins e admin pelo LID (sem device): posta e convida', () => {
    expect(baileysGroupPermissions({ announce: true, participants: [{ id: '777@lid', admin: 'superadmin' }] }, user))
      .toEqual({ canPost: true, postBlockedReason: null, canInvite: true, inviteBlockedReason: null });
  });

  it('admin pelo telefone', () => {
    expect(baileysGroupPermissions({ announce: true, participants: [{ id: '5511999990000@s.whatsapp.net', admin: 'admin' }] }, user).canPost).toBe(true);
  });
});

describe('BaileysMessagingEngineAdapter.listParticipatingGroups', () => {
  it('anota permissões a partir de uma única chamada e usa o cache', async () => {
    const groupFetchAllParticipating = vi.fn(async () => ({
      '1@g.us': { id: '1@g.us', subject: 'Aberto', announce: false, participants: [{ id: '777@lid' }] },
      '2@g.us': { id: '2@g.us', subject: 'Avisos', announce: true, participants: [{ id: '777@lid' }] },
    }));
    BaileysSessionRegistry.get().set(S, { socket: { user, groupFetchAllParticipating }, tenantId: 't1' } as never);
    const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
    const out = await adapter.listParticipatingGroups(S);
    expect(out.map((g) => [g.groupJid, g.canPost, g.postBlockedReason])).toEqual([['1', true, null], ['2', false, 'ADMINS_ONLY']]);
    await adapter.listParticipatingGroups(S);
    expect(groupFetchAllParticipating).toHaveBeenCalledTimes(1);
  });
});
