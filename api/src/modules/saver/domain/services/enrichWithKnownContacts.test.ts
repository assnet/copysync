import { describe, expect, it } from 'vitest';
import { enrichWithKnownContacts } from './enrichWithKnownContacts';
import { mergeGroupRead } from './mergeGroupRead';

const m = (phone: string | null, lid: string | null, name: string | null = null) => ({ phone, lid, name, isAdmin: false });

describe('enrichWithKnownContacts', () => {
  it('completa telefone do só-LID e nome do vínculo; não altera a entrada', () => {
    const members = [m(null, '777'), m('5511999990001', null)];
    const out = enrichWithKnownContacts(members, [
      { phone: '5511988887777', lid: '777', name: 'Bia' },
      { phone: '5511999990001', lid: null, name: 'Caio' },
    ]);
    expect(out).toEqual([
      { ...m('5511988887777', '777'), tenantName: 'Bia' },
      { ...m('5511999990001', null), tenantName: 'Caio' },
    ]);
    expect(members[0]!.phone).toBeNull();
  });

  it('nunca troca telefone lido nem nome lido', () => {
    const members = [m('5511900000000', '777', 'Lido')];
    expect(enrichWithKnownContacts(members, [{ phone: '5511988887777', lid: '777', name: 'Outro' }])).toEqual(members);
  });

  it('ignora telefone implausível, par LID = telefone e nome que é só número', () => {
    const out = enrichWithKnownContacts([m(null, '777'), m(null, '888'), m(null, '999')], [
      { phone: '1234567890123456789', lid: '777', name: 'X' },
      { phone: '888', lid: '888', name: 'Y' },
      { phone: '5511977776666', lid: '999', name: '+55 11 97777-6666' },
    ]);
    expect(out).toEqual([m(null, '777'), m(null, '888'), m('5511977776666', '999')]);
  });

  it('linha repetida do mesmo LID: vale a primeira (mais recente)', () => {
    const out = enrichWithKnownContacts([m(null, '777')], [
      { phone: '5511911111111', lid: '777', name: null },
      { phone: '5511922222222', lid: '777', name: null },
    ]);
    expect(out[0]!.phone).toBe('5511911111111');
  });

  it('mergeGroupRead: tenantName vai só para o vínculo, nunca para o contato da plataforma', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const r = mergeGroupRead({
      contacts: [], memberships: [], now, extractionId: 'e1',
      members: [{ ...m('5511988887777', '777'), tenantName: 'Bia' }],
    });
    expect(r.contactInserts).toEqual([{ phone: '5511988887777', lid: '777', name: null, firstSeenAt: now, lastSeenAt: now }]);
    expect(r.membershipUpserts[0]!.name).toBe('Bia');
  });
});
