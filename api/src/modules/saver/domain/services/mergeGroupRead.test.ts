import { describe, it, expect } from 'vitest';
import {
  mergeGroupRead,
  normalizeLid,
  normalizePhone,
  type BaseContactState,
  type GroupMembershipState,
  type SaverReadMember,
} from './mergeGroupRead';

const T0 = new Date('2026-11-01T10:00:00Z');
const T1 = new Date('2026-11-05T10:00:00Z');
const NOW = new Date('2026-11-17T12:00:00Z');

function contact(o: Partial<BaseContactState> & { id: string }): BaseContactState {
  return { phone: null, lid: null, name: null, firstSeenAt: T0, lastSeenAt: T0, ...o };
}
function member(o: Partial<SaverReadMember>): SaverReadMember {
  return { phone: null, lid: null, name: null, isAdmin: false, ...o };
}
function link(o: Partial<GroupMembershipState> & { contactId: string }): GroupMembershipState {
  return { name: null, isAdmin: false, firstExtractedAt: T0, lastExtractedAt: T0, leftAt: null, ...o };
}
function run(contacts: BaseContactState[], members: SaverReadMember[], memberships: GroupMembershipState[] = []) {
  return mergeGroupRead({ contacts, memberships, members, now: NOW, extractionId: 'ext-1' });
}

describe('normalização', () => {
  it('telefone vira só dígitos; LID perde o sufixo', () => {
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('5511999990000');
    expect(normalizePhone('5511999990000:3@s.whatsapp.net')).toBe('5511999990000');
    expect(normalizePhone('  ')).toBeNull();
    expect(normalizeLid('123456@lid')).toBe('123456');
    expect(normalizeLid('')).toBeNull();
  });
});

describe('mergeGroupRead', () => {
  it('primeiro scan: insere contatos e cria vínculos com data da extração', () => {
    const r = run([], [member({ phone: '551100', name: 'Ana', isAdmin: true }), member({ lid: 'L1' })]);
    expect(r.contactInserts).toEqual([
      { phone: '551100', lid: null, name: 'Ana', firstSeenAt: NOW, lastSeenAt: NOW },
      { phone: null, lid: 'L1', name: null, firstSeenAt: NOW, lastSeenAt: NOW },
    ]);
    expect(r.membershipUpserts).toHaveLength(2);
    expect(r.membershipUpserts[0]).toMatchObject({
      contact: { newIndex: 0 },
      name: 'Ana',
      isAdmin: true,
      firstExtractedAt: NOW,
      lastExtractedAt: NOW,
      lastExtractionId: 'ext-1',
      isNewInGroup: true,
    });
    expect(r.contactUpdates).toEqual([]);
    expect(r.markLeft).toEqual([]);
    expect(r.membersRead).toBe(2);
  });

  it('pessoa já na base por outro grupo/tenant: 0 inserção, 1 vínculo com o nome desta leitura', () => {
    const r = run([contact({ id: 'c1', phone: '551100', name: 'Nome de outro tenant' })], [member({ phone: '551100', name: 'Ana' })]);
    expect(r.contactInserts).toEqual([]);
    expect(r.membershipUpserts).toEqual([
      expect.objectContaining({ contact: { existingId: 'c1' }, name: 'Ana', lastExtractedAt: NOW, isNewInGroup: true }),
    ]);
  });

  it('releitura atualiza lastExtractedAt e mantém firstExtractedAt', () => {
    const r = run(
      [contact({ id: 'c1', phone: '551100' })],
      [member({ phone: '551100' })],
      [link({ contactId: 'c1', name: 'Ana', firstExtractedAt: T0, lastExtractedAt: T1 })],
    );
    expect(r.membershipUpserts[0]).toMatchObject({ firstExtractedAt: T0, lastExtractedAt: NOW, name: 'Ana', isNewInGroup: false });
  });

  it('membro que saiu recebe leftAt; quem já tinha saído não muda', () => {
    const r = run(
      [contact({ id: 'c1', phone: '551100' })],
      [member({ phone: '551100' })],
      [link({ contactId: 'c1' }), link({ contactId: 'c2' }), link({ contactId: 'c3', leftAt: T1 })],
    );
    expect(r.markLeft).toEqual([{ contactId: 'c2', leftAt: NOW }]);
  });

  it('quem voltou tem leftAt limpo', () => {
    const r = run([contact({ id: 'c1', phone: '551100' })], [member({ phone: '551100' })], [link({ contactId: 'c1', leftAt: T1 })]);
    expect(r.membershipUpserts[0]).toMatchObject({ leftAt: null, isNewInGroup: false, firstExtractedAt: T0 });
  });

  it('LID que ganhou telefone continua 1 contato', () => {
    const r = run([contact({ id: 'c1', lid: 'L1' })], [member({ lid: 'L1', phone: '551100' })]);
    expect(r.contactInserts).toEqual([]);
    expect(r.contactUpdates).toEqual([{ id: 'c1', phone: '551100', lastSeenAt: NOW }]);
  });

  it('LID e telefone em contatos distintos: funde no mais antigo e o vínculo fica no sobrevivente', () => {
    const r = run(
      [
        contact({ id: 'cLid', lid: 'L1', name: 'Antigo', firstSeenAt: T1, lastSeenAt: T1 }),
        contact({ id: 'cPhone', phone: '551100', firstSeenAt: T0, lastSeenAt: T0 }),
      ],
      [member({ lid: 'L1', phone: '551100' })],
      [link({ contactId: 'cLid', name: 'Do vínculo', firstExtractedAt: T1 })],
    );
    expect(r.contactMerges).toEqual([{ survivorId: 'cPhone', absorbedId: 'cLid' }]);
    expect(r.contactInserts).toEqual([]);
    expect(r.contactUpdates).toEqual([{ id: 'cPhone', lid: 'L1', name: 'Antigo', lastSeenAt: NOW }]);
    expect(r.membershipUpserts).toEqual([
      expect.objectContaining({ contact: { existingId: 'cPhone' }, name: 'Do vínculo', firstExtractedAt: T1, isNewInGroup: false }),
    ]);
    expect(r.markLeft).toEqual([]);
  });

  it('fusão leva o nome não vazio mais recente e a primeira data mais antiga', () => {
    const r = run(
      [
        contact({ id: 'a', lid: 'L1', name: 'Velho', firstSeenAt: T0, lastSeenAt: T0 }),
        contact({ id: 'b', phone: '551100', name: 'Novo', firstSeenAt: T1, lastSeenAt: T1 }),
      ],
      [member({ lid: 'L1', phone: '551100' })],
    );
    expect(r.contactMerges).toEqual([{ survivorId: 'a', absorbedId: 'b' }]);
    expect(r.contactUpdates).toEqual([{ id: 'a', phone: '551100', name: 'Novo', lastSeenAt: NOW }]);
  });

  it('nome vazio não apaga nome existente (contato e vínculo)', () => {
    const r = run(
      [contact({ id: 'c1', phone: '551100', name: 'Ana' })],
      [member({ phone: '551100', name: '   ' })],
      [link({ contactId: 'c1', name: 'Ana do grupo' })],
    );
    expect(r.contactUpdates).toEqual([{ id: 'c1', lastSeenAt: NOW }]);
    expect(r.membershipUpserts[0]!.name).toBe('Ana do grupo');
  });

  it('nome lido não vazio sobrescreve o do contato', () => {
    const r = run([contact({ id: 'c1', phone: '551100', name: 'Ana' })], [member({ phone: '551100', name: 'Ana Souza' })]);
    expect(r.contactUpdates).toEqual([{ id: 'c1', name: 'Ana Souza', lastSeenAt: NOW }]);
  });

  it('contato com telefone relido só com LID mantém o telefone', () => {
    const r = run([contact({ id: 'c1', phone: '551100', lid: 'L1' })], [member({ lid: 'L1' })]);
    expect(r.contactUpdates).toEqual([{ id: 'c1', lastSeenAt: NOW }]);
    expect(r.contactInserts).toEqual([]);
  });

  it('LID conhecido com telefone diferente: o telefone antigo fica e o novo vira outro contato', () => {
    const r = run([contact({ id: 'c1', phone: '551100', lid: 'L1' })], [member({ lid: 'L1', phone: '552200', name: 'Bia' })]);
    expect(r.contactUpdates).toEqual([{ id: 'c1', lastSeenAt: NOW }]);
    expect(r.contactInserts).toEqual([{ phone: '552200', lid: null, name: 'Bia', firstSeenAt: NOW, lastSeenAt: NOW }]);
    expect(r.membershipUpserts).toEqual([expect.objectContaining({ contact: { newIndex: 0 } })]);
    expect(r.contactMerges).toEqual([]);
  });

  it('contato só-telefone + leitura só-LID = 2 contatos; fundidos quando o par chega', () => {
    const first = run([contact({ id: 'cP', phone: '551100' })], [member({ lid: 'L1' })]);
    expect(first.contactInserts).toEqual([expect.objectContaining({ phone: null, lid: 'L1' })]);
    expect(first.contactMerges).toEqual([]);

    const second = run(
      [contact({ id: 'cP', phone: '551100', firstSeenAt: T0 }), contact({ id: 'cL', lid: 'L1', firstSeenAt: T1 })],
      [member({ lid: 'L1', phone: '551100' })],
    );
    expect(second.contactMerges).toEqual([{ survivorId: 'cP', absorbedId: 'cL' }]);
  });

  it('LID e telefone em contatos que já têm outro valor: não funde, fica com o do telefone', () => {
    const r = run(
      [contact({ id: 'cL', lid: 'L1', phone: '559900' }), contact({ id: 'cP', phone: '551100', lid: 'L2' })],
      [member({ lid: 'L1', phone: '551100' })],
    );
    expect(r.contactMerges).toEqual([]);
    expect(r.contactInserts).toEqual([]);
    expect(r.membershipUpserts).toEqual([expect.objectContaining({ contact: { existingId: 'cP' } })]);
  });

  it('nunca funde por nome', () => {
    const r = run([contact({ id: 'c1', phone: '551100', name: 'Ana' })], [member({ phone: '552200', name: 'Ana' })]);
    expect(r.contactMerges).toEqual([]);
    expect(r.contactInserts).toHaveLength(1);
  });

  it('participante sem telefone e sem LID é ignorado; repetido vira um só', () => {
    const r = run([], [member({ name: 'Fantasma' }), member({ phone: '551100' }), member({ phone: '551100', lid: 'L1', isAdmin: true })]);
    expect(r.membersRead).toBe(1);
    expect(r.contactInserts).toEqual([expect.objectContaining({ phone: '551100', lid: 'L1' })]);
    expect(r.membershipUpserts[0]!.isAdmin).toBe(true);
  });

  it('1.000 membros em menos de 50 ms', () => {
    const contacts = Array.from({ length: 500 }, (_, i) => contact({ id: `c${i}`, phone: `55110000${i}` }));
    const members = Array.from({ length: 1000 }, (_, i) =>
      member({ phone: `55110000${i}`, lid: i % 2 ? `L${i}` : null, name: `M${i}` }),
    );
    const memberships = contacts.map((c) => link({ contactId: c.id }));
    run(contacts, members, memberships);
    const start = performance.now();
    const r = run(contacts, members, memberships);
    expect(performance.now() - start).toBeLessThan(50);
    expect(r.contactInserts).toHaveLength(500);
    expect(r.membershipUpserts).toHaveLength(1000);
  });
});
