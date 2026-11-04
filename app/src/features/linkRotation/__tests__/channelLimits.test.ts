import { describe, expect, it } from 'vitest';
import {
  createButtonLockOf, createLockOf, groupLimitOf, limitKindOfKey, normalizeRotationOverview, planUnlockingChannel, sessionLockOf,
} from '../channelLimits';
import type { Rotation } from '../types';

const rot = (id: string, channel: 'whatsapp' | 'telegram', status: Rotation['status'] = 'ACTIVE') => ({ id, channel, status }) as Rotation;
const wa = { id: 's1', name: 'A', status: 'CONNECTED' as const, channel: 'whatsapp' as const, avatarUrl: null };
const tg = { ...wa, id: 's2', channel: 'telegram' as const };
const lite = {
  limits: {
    linkRotations: 1, linkRotationGroups: 3,
    whatsapp: { rotations: 1, groupsPerRotation: 3 }, telegram: { rotations: 0, groupsPerRotation: 0 },
  },
  usage: { whatsapp: { rotations: 1 }, telegram: { rotations: 0 } },
};

describe('normalizeRotationOverview', () => {
  it('sem blocos por canal: raiz vale para os dois e uso é contado pelos rodízios', () => {
    const o = normalizeRotationOverview({ rotations: [rot('r1', 'telegram', 'PAUSED')], limits: { linkRotations: 2, linkRotationGroups: 4 } });
    expect(o.limits.whatsapp).toEqual({ rotations: 2, groupsPerRotation: 4 });
    expect(o.limits.telegram).toEqual({ rotations: 2, groupsPerRotation: 4 });
    expect(o.usage).toEqual({ whatsapp: { rotations: 0 }, telegram: { rotations: 1 } });
  });

  it('com blocos: usa os do canal, null = ilimitado, resposta vazia não quebra', () => {
    const o = normalizeRotationOverview({ ...lite, limits: { ...lite.limits, telegram: { rotations: null, groupsPerRotation: 10 } } });
    expect(o.limits.telegram).toEqual({ rotations: null, groupsPerRotation: 10 });
    expect(groupLimitOf(o, 'whatsapp')).toBe(3);
    expect(normalizeRotationOverview({}).rotations).toEqual([]);
  });
});

describe('travas por canal', () => {
  const o = normalizeRotationOverview({ ...lite, rotations: [rot('r1', 'whatsapp')], sessions: [wa, tg] });

  it('WhatsApp cheio e Telegram fora do plano (a partir do PRO)', () => {
    expect(createLockOf(o, 'whatsapp')).toMatchObject({ reason: 'full', kind: 'rotations', limit: 1 });
    const tgLock = createLockOf(o, 'telegram')!;
    expect(tgLock).toMatchObject({ reason: 'noPlan', kind: 'telegramLinkRotations', limit: 0 });
    expect(planUnlockingChannel(tgLock)).toBe('PRO');
    expect(createButtonLockOf(o)).toMatchObject({ kind: 'rotations' });
  });

  it('botão livre quando algum canal com sessão tem vaga', () => {
    const pro = normalizeRotationOverview({ ...o, limits: { ...lite.limits, telegram: { rotations: 1, groupsPerRotation: 5 } } });
    expect(createButtonLockOf(pro)).toBeNull();
  });

  it('edição: mesmo canal livre; outro canal só trava com o link ativo', () => {
    const r = rot('r1', 'whatsapp');
    expect(sessionLockOf(o, wa, r)).toBeNull();
    expect(sessionLockOf(o, tg, r)).toMatchObject({ reason: 'noPlan' });
    expect(sessionLockOf(o, tg, r, false)).toBeNull();
  });

  it('meta.key → tipo do aviso', () => {
    expect(limitKindOfKey('telegram_link_rotations')).toBe('telegramLinkRotations');
    expect(limitKindOfKey('telegram_link_rotation_groups')).toBe('telegramLinkRotationGroups');
    expect(limitKindOfKey('x')).toBeNull();
  });
});
