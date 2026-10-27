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
      { groupJid: '444', title: 'Achados', avatarUrl: null, conversationId: null },
      { groupJid: '222', title: 'beta ofertas', avatarUrl: null, conversationId: null },
      { groupJid: '111', title: 'Promoções Ágeis', avatarUrl: 'https://x/p.jpg', conversationId: 'c1' },
      { groupJid: '333', title: null, avatarUrl: null, conversationId: null },
    ]);
  });

  it('sem WhatsApp (sessão fora): cai no que o chat conhece', () => {
    expect(mergeSessionGroups(null, known).map((g) => g.conversationId)).toEqual(['c9', 'c1']);
  });

  it('busca ignora acento e caixa', () => {
    expect(mergeSessionGroups(live, known, 'AGEIS').map((g) => g.groupJid)).toEqual(['111']);
    expect(mergeSessionGroups(live, known, '  ofer ').map((g) => g.groupJid)).toEqual(['222']);
  });
});
