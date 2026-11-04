import { describe, expect, it } from 'vitest';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { telegramGroupPermissions } from './TelegramMessagingEngineAdapter';

const channel = (extra: Partial<ConstructorParameters<typeof Api.Channel>[0]>) =>
  new Api.Channel({ id: bigInt(1), title: 'X', photo: new Api.ChatPhotoEmpty(), date: 0, ...extra });
const banned = new Api.ChatBannedRights({ untilDate: 0, sendMessages: true });

describe('telegramGroupPermissions', () => {
  it('canal de transmissão sem postar: CHANNEL_READONLY e NOT_ADMIN', () => {
    expect(telegramGroupPermissions(channel({ broadcast: true })))
      .toEqual({ canPost: false, postBlockedReason: 'CHANNEL_READONLY', canInvite: false, inviteBlockedReason: 'NOT_ADMIN' });
  });

  it('supergrupo com envio banido por padrão: ADMINS_ONLY', () => {
    expect(telegramGroupPermissions(channel({ megagroup: true, defaultBannedRights: banned })))
      .toMatchObject({ canPost: false, postBlockedReason: 'ADMINS_ONLY' });
  });

  it('criador: posta e convida', () => {
    expect(telegramGroupPermissions(channel({ broadcast: true, creator: true })))
      .toEqual({ canPost: true, postBlockedReason: null, canInvite: true, inviteBlockedReason: null });
  });
});
