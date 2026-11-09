import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { TelegramMessagingEngineAdapter } from './TelegramMessagingEngineAdapter';
import { internalEventBus } from '../../../../../shared/events/InternalEventBus';
import type { IIncomingMediaPolicy } from '../../../domain/contracts/IIncomingMediaPolicy';

const S = 'tg-mp';
const T = 'tenant-tg';

function make(policy?: IIncomingMediaPolicy) {
  const conversations = { findActiveByGroupAndSession: vi.fn(async () => ({ autoDownloadMedia: true })) };
  const adapter = new TelegramMessagingEngineAdapter(
    { apiId: 1, apiHash: 'x', channelCatchUp: false }, {} as never, {} as never, conversations as never,
    undefined, undefined, policy,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = adapter as any;
  const entry = { epoch: 1, tenantId: T, sentIds: new Set<string>(), phone: null, pending: null };
  a.registry.set(S, entry);
  const download = vi.spyOn(a, 'downloadInboundMedia').mockResolvedValue('/media/tg.jpg');
  const events: Array<Record<string, unknown>> = [];
  internalEventBus.on('MESSAGE_RECEIVED', (e) => { events.push(e as unknown as Record<string, unknown>); });
  const receive = (msg: unknown) => a.handleIncoming(S, entry, msg, async () => ({ title: 'Grupo' }));
  return { receive, download, events, conversations };
}

function photo(id: number, group: boolean) {
  return {
    id,
    out: false,
    peerId: group ? new Api.PeerChannel({ channelId: bigInt(777) }) : new Api.PeerUser({ userId: bigInt(555) }),
    fromId: new Api.PeerUser({ userId: bigInt(555) }),
    message: 'oferta https://loja.com/p',
    media: new Api.MessageMediaPhoto({}),
    replyTo: null,
    getSender: async () => ({ firstName: 'Ana' }),
  };
}

afterEach(() => internalEventBus.removeAllListeners('MESSAGE_RECEIVED'));

describe('Telegram — política de mídia recebida (entrega D)', () => {
  it('sem política: 1:1 baixa como hoje', async () => {
    const { receive, download, events } = make();
    await receive(photo(1, false));
    expect(download).toHaveBeenCalledTimes(1);
    expect(events[0]?.mediaUrl).toBe('/media/tg.jpg');
  });

  it('política negada: não baixa e emite o evento sem mídia', async () => {
    const shouldDownload = vi.fn(async () => false);
    const { receive, download, events } = make({ shouldDownload });
    await receive(photo(2, false));
    expect(shouldDownload).toHaveBeenCalledWith(
      { tenantId: T, sessionId: S, isGroup: false, groupJid: null, msgType: 'IMAGE', fromMe: false },
      expect.any(Function),
    );
    expect(download).not.toHaveBeenCalled();
    expect(events[0]?.mediaUrl).toBeNull();
  });

  it('grupo: a regra atual entregue à política lê autoDownloadMedia da conversa', async () => {
    const policy: IIncomingMediaPolicy = { shouldDownload: (_c, rule) => rule() };
    const { receive, download, conversations } = make(policy);
    await receive(photo(3, true));
    expect(conversations.findActiveByGroupAndSession).toHaveBeenCalledWith('-100777', S, T);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
