import { describe, expect, it, vi } from 'vitest';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { TelegramChannelCatchUp, isChannelDue, nextPollAt, type CatchUpClient } from './TelegramChannelCatchUp';

const JID = '-1002471713366';
const logger = { debug: vi.fn(), warn: vi.fn() };

function message(id: number, dateSec: number): Api.Message {
  return new Api.Message({ id, date: dateSec, message: `post ${id}`, peerId: new Api.PeerChannel({ channelId: bigInt(2471713366) }) });
}

function setup(responses: unknown[], now: { t: number }) {
  const invoke = vi.fn(async (req: unknown) => {
    if (req instanceof Api.channels.GetFullChannel) {
      return { fullChat: new Api.ChannelFull({ pts: 10 } as never) };
    }
    return responses.shift();
  });
  const client = {
    invoke,
    getInputEntity: vi.fn(async () => new Api.InputPeerChannel({ channelId: bigInt(2471713366), accessHash: bigInt(1) })),
    getDialogs: vi.fn(async () => []),
  } as unknown as CatchUpClient;
  const onMessage = vi.fn(async () => undefined);
  const source = { listWatchedChannels: vi.fn(async () => [JID]) };
  const c = new TelegramChannelCatchUp({ sessionId: 's1', tenantId: 't1', client, source, onMessage, logger, now: () => now.t });
  return { c, invoke, onMessage, source };
}

describe('regras de agenda', () => {
  it('push recente adia a consulta', () => {
    expect(isChannelDue(0, 1_000, 30_000)).toBe(false);
    expect(isChannelDue(0, 1_000, 200_000)).toBe(true);
    expect(isChannelDue(0, undefined, 1)).toBe(true);
    expect(isChannelDue(5_000, undefined, 1)).toBe(false);
  });

  it('respeita o timeout do Telegram quando maior que o intervalo base', () => {
    expect(nextPollAt(0, undefined)).toBe(60_000);
    expect(nextPollAt(0, 300)).toBe(300_000);
  });
});

describe('TelegramChannelCatchUp', () => {
  it('1ª rodada só marca o pts; depois emite post novo e ignora o anterior ao início', async () => {
    const now = { t: 1_000_000_000 };
    const startSec = now.t / 1_000;
    const { c, invoke, onMessage } = setup([
      new Api.updates.ChannelDifference({
        pts: 12, final: true, newMessages: [message(5, startSec - 10), message(6, startSec + 30)], otherUpdates: [], chats: [], users: [],
      }),
    ], now);

    await c.tick();
    expect(invoke).toHaveBeenCalledTimes(1); // GetFullChannel
    expect(onMessage).not.toHaveBeenCalled();

    now.t += 61_000;
    await c.tick();
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect((onMessage.mock.calls[0] as unknown as [Api.Message])[0].id).toBe(6);
  });

  it('canal com push recente não é consultado', async () => {
    const now = { t: 1_000_000_000 };
    const { c, invoke } = setup([], now);
    await c.tick();
    now.t += 61_000;
    c.notePush(JID);
    await c.tick();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('FLOOD_WAIT pausa a sessão', async () => {
    const now = { t: 1_000_000_000 };
    const { c, invoke } = setup([], now);
    await c.tick();
    invoke.mockRejectedValueOnce(Object.assign(new Error('FLOOD'), { seconds: 120 }));
    now.t += 61_000;
    await c.tick();
    now.t += 61_000;
    await c.tick(); // ainda pausado
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('stop impede novas rodadas', async () => {
    const now = { t: 1 };
    const { c, source } = setup([], now);
    c.stop();
    await c.tick();
    expect(source.listWatchedChannels).not.toHaveBeenCalled();
  });
});
