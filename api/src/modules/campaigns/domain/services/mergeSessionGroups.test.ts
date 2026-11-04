import { describe, expect, it } from 'vitest';
import { mergeSessionGroups } from './mergeSessionGroups';

const known = [
  { conversationId: 'c1', groupJid: '111', title: 'Promoções Ágeis', avatarUrl: 'https://x/p.jpg' },
  { conversationId: 'c9', groupJid: '999', title: 'Grupo que saí', avatarUrl: null },
];
const live = [
  { groupJid: '222', name: 'beta ofertas' },
  { groupJid: '111', name: 'Promoções Ágeis' },
  { groupJid: '333', name: null },
  { groupJid: '444', name: 'Achados' },
];

describe('mergeSessionGroups', () => {
  it('com WhatsApp: vale a lista dele, cruza conversationId e ordena por nome (sem título no fim)', () => {
    expect(mergeSessionGroups(live, known)).toEqual([
      { groupJid: '444', title: 'Achados', avatarUrl: null, conversationId: null, canPost: true, canInvite: true },
      { groupJid: '222', title: 'beta ofertas', avatarUrl: null, conversationId: null, canPost: true, canInvite: true },
      { groupJid: '111', title: 'Promoções Ágeis', avatarUrl: 'https://x/p.jpg', conversationId: 'c1', canPost: true, canInvite: true },
      { groupJid: '333', title: null, avatarUrl: null, conversationId: null, canPost: true, canInvite: true },
    ]);
  });

  it('foto da engine (Telegram) vale quando a conversa não tem; a da conversa tem prioridade', () => {
    const tg = [
      { groupJid: '-100555', name: 'Canal', avatarUrl: 'https://x/tg.jpg' },
      { groupJid: '111', name: 'Promoções Ágeis', avatarUrl: 'https://x/outra.jpg' },
    ];
    const out = mergeSessionGroups(tg, known);
    expect(out.find((g) => g.groupJid === '-100555')?.avatarUrl).toBe('https://x/tg.jpg');
    expect(out.find((g) => g.groupJid === '111')?.avatarUrl).toBe('https://x/p.jpg');
  });

  it('canPost: vem da engine (ausente = true); sem engine, conhecidos valem true', () => {
    const tg = [{ groupJid: '-100555', name: 'Canal', canPost: false }, { groupJid: '-100666', name: 'Grupo' }];
    expect(mergeSessionGroups(tg, known).map((g) => [g.groupJid, g.canPost])).toEqual([['-100555', false], ['-100666', true]]);
    expect(mergeSessionGroups(null, known).every((g) => g.canPost)).toBe(true);
  });

  it('canInvite: vem da engine (ausente = true); sem engine, conhecidos valem true', () => {
    const tg = [{ groupJid: '-100555', name: 'Canal', canInvite: true }, { groupJid: '-100666', name: 'Grupo', canInvite: false }, { groupJid: '-100777', name: 'Outro' }];
    expect(mergeSessionGroups(tg, known).map((g) => [g.groupJid, g.canInvite])).toEqual([['-100555', true], ['-100666', false], ['-100777', true]]);
    expect(mergeSessionGroups(null, known).every((g) => g.canInvite)).toBe(true);
  });

  it('sem WhatsApp (sessão fora): cai no que o chat conhece', () => {
    expect(mergeSessionGroups(null, known).map((g) => g.conversationId)).toEqual(['c9', 'c1']);
  });

  it('busca ignora acento e caixa', () => {
    expect(mergeSessionGroups(live, known, 'AGEIS').map((g) => g.groupJid)).toEqual(['111']);
    expect(mergeSessionGroups(live, known, '  ofer ').map((g) => g.groupJid)).toEqual(['222']);
  });
});
