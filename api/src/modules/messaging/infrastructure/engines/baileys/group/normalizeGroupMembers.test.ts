import { describe, it, expect } from 'vitest';
import { normalizeGroupMembers } from './normalizeGroupMembers';

describe('normalizeGroupMembers', () => {
  it('participante PN: telefone do id, sem LID', () => {
    expect(normalizeGroupMembers([{ id: '5511999990000@s.whatsapp.net', notify: 'Ana' }]))
      .toEqual([{ phone: '5511999990000', lid: null, name: 'Ana', isAdmin: false }]);
  });

  it('participante PN com lid informado traz os dois', () => {
    expect(normalizeGroupMembers([{ id: '5511999990000:2@s.whatsapp.net', lid: '123456@lid' }]))
      .toEqual([{ phone: '5511999990000', lid: '123456', name: null, isAdmin: false }]);
  });

  it('participante @lid com phoneNumber traz telefone e LID', () => {
    expect(normalizeGroupMembers([{ id: '987654@lid', phoneNumber: '5521988887777@s.whatsapp.net', name: 'Bia' }]))
      .toEqual([{ phone: '5521988887777', lid: '987654', name: 'Bia', isAdmin: false }]);
  });

  it('participante @lid sem número fica só com LID', () => {
    expect(normalizeGroupMembers([{ id: '987654@lid' }]))
      .toEqual([{ phone: null, lid: '987654', name: null, isAdmin: false }]);
  });

  it('admin e superadmin viram isAdmin', () => {
    const r = normalizeGroupMembers([
      { id: '1@lid', admin: 'admin' },
      { id: '2@lid', admin: 'superadmin' },
      { id: '3@lid', admin: null },
    ]);
    expect(r.map((m) => m.isAdmin)).toEqual([true, true, false]);
  });

  it('nome: name, depois notify, depois verifiedName; vazio vira null', () => {
    const r = normalizeGroupMembers([
      { id: '1@lid', name: ' N ', notify: 'x' },
      { id: '2@lid', name: '', notify: 'Notify' },
      { id: '3@lid', verifiedName: 'Loja' },
      { id: '4@lid', name: '  ' },
    ]);
    expect(r.map((m) => m.name)).toEqual(['N', 'Notify', 'Loja', null]);
  });

  it('descarta participante sem telefone nem LID e tolera lista ausente', () => {
    expect(normalizeGroupMembers([{ id: 'abc@g.us' }, {}])).toEqual([]);
    expect(normalizeGroupMembers(undefined)).toEqual([]);
  });
});
