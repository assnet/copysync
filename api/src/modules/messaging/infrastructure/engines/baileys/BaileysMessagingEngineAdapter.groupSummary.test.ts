import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';

vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
  releaseAuthState: async () => undefined,
  discardAuthState: async () => undefined,
}));

const S = 'sess-group-summary';
const user = { id: '5511999990000:3@s.whatsapp.net', lid: '777:3@lid' };

function make(participants: unknown[], extra: Record<string, unknown> = {}) {
  const groupMetadata = vi.fn(async () => ({ subject: ' Ofertas ', participants, ...extra }));
  const groupInviteCode = vi.fn(async () => 'AbC123');
  const socket = { user, groupMetadata, groupInviteCode };
  BaileysSessionRegistry.get().set(S, { socket, tenantId: 't1' } as never);
  const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
  return { adapter, groupMetadata, groupInviteCode };
}

beforeEach(() => BaileysSessionRegistry.get().delete(S));

describe('BaileysMessagingEngineAdapter.getGroupSummary', () => {
  it('admin pelo telefone (grupo PN); size do WhatsApp prevalece', async () => {
    const { adapter, groupMetadata } = make(
      [{ id: '5511999990000@s.whatsapp.net', admin: 'admin' }, { id: '5511888887777@s.whatsapp.net' }],
      { size: 250 },
    );
    expect(await adapter.getGroupSummary(S, '1203')).toEqual({ name: 'Ofertas', memberCount: 250, isSelfAdmin: true });
    expect(groupMetadata).toHaveBeenCalledWith('1203@g.us');
  });

  it('admin pelo LID (grupo LID); sem size conta participantes', async () => {
    const { adapter } = make([{ id: '777@lid', phoneNumber: '5511999990000@s.whatsapp.net', admin: 'superadmin' }, { id: '888@lid' }]);
    expect(await adapter.getGroupSummary(S, '1203@g.us')).toEqual({ name: 'Ofertas', memberCount: 2, isSelfAdmin: true });
  });

  it('membro comum não é admin', async () => {
    const { adapter } = make([{ id: '777@lid' }, { id: '888@lid', admin: 'admin' }]);
    expect((await adapter.getGroupSummary(S, '1203')).isSelfAdmin).toBe(false);
  });

  it('segunda leitura dentro do prazo usa o cache', async () => {
    const { adapter, groupMetadata } = make([{ id: '777@lid' }]);
    await adapter.getGroupSummary(S, '1203');
    await adapter.getGroupSummary(S, '1203@g.us');
    expect(groupMetadata).toHaveBeenCalledTimes(1);
  });

  it('sessão não conectada lança SESSION_NOT_CONNECTED', async () => {
    const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(adapter.getGroupSummary('nope', '1203')).rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED' });
  });
});

describe('BaileysMessagingEngineAdapter.getGroupInviteLink', () => {
  it('devolve o código e completa @g.us', async () => {
    const { adapter, groupInviteCode } = make([]);
    expect(await adapter.getGroupInviteLink(S, '1203')).toEqual({ inviteCode: 'AbC123' });
    expect(groupInviteCode).toHaveBeenCalledWith('1203@g.us');
  });

  it('IQ 403 vira GROUP_INVITE_NOT_ALLOWED', async () => {
    const { adapter, groupInviteCode } = make([]);
    groupInviteCode.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { output: { statusCode: 500 }, data: 403 }));
    await expect(adapter.getGroupInviteLink(S, '1203')).rejects.toMatchObject({ code: 'GROUP_INVITE_NOT_ALLOWED' });
  });
});
