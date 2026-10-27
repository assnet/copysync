import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaileysMessagingEngineAdapter } from './BaileysMessagingEngineAdapter';
import { BaileysSessionRegistry } from './BaileysSessionRegistry';

vi.mock('./BaileysAuthStatePersistence', () => ({
  buildBaileysAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
  flushAllAuthStates: async () => undefined,
}));

const S = 'sess-typing';

function make() {
  const sendPresenceUpdate = vi.fn(async () => undefined);
  const socket = { sendPresenceUpdate, user: { id: '5511999990000:1@s.whatsapp.net' }, ws: { isOpen: true } };
  BaileysSessionRegistry.get().set(S, { socket, tenantId: 't1' } as never);
  const adapter = new BaileysMessagingEngineAdapter({} as never, {} as never, {} as never, {} as never, {} as never);
  return { adapter, calls: sendPresenceUpdate.mock.calls as unknown as unknown[][] };
}

beforeEach(() => BaileysSessionRegistry.get().delete(S));

describe('BaileysMessagingEngineAdapter.sendPresence', () => {
  // A conta sobe "indisponível" (markOnlineOnConnect: false) e o WhatsApp não exibe o
  // "digitando…" de quem está offline: fica online só durante a digitação.
  it('grupo: available uma vez, composing renovado, paused e unavailable no fim', async () => {
    const { adapter, calls } = make();
    await adapter.sendPresence(S, '1203', 'composing');
    await adapter.sendPresence(S, '1203', 'composing');
    await adapter.sendPresence(S, '1203', 'paused');
    expect(calls).toEqual([
      ['available'],
      ['composing', '1203@s.whatsapp.net'],
      ['composing', '1203@s.whatsapp.net'],
      ['paused', '1203@s.whatsapp.net'],
      ['unavailable'],
    ]);
  });

  it('jid de grupo passa inteiro; paused sem composing antes não manda unavailable', async () => {
    const { adapter, calls } = make();
    await adapter.sendPresence(S, '1203@g.us', 'paused');
    expect(calls).toEqual([['paused', '1203@g.us']]);
  });
});
