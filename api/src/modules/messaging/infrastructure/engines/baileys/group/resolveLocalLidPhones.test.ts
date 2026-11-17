import { describe, expect, it, vi } from 'vitest';
import { normalizeGroupMembers } from './normalizeGroupMembers';
import { LOCAL_LID_LOOKUP_BATCH, resolveLocalLidPhones } from './resolveLocalLidPhones';

const member = (lid: string | null, phone: string | null = null) => ({ phone, lid, name: null, isAdmin: false });

describe('resolveLocalLidPhones', () => {
  it('completa o telefone do membro só-LID pelo mapa local (JID com device)', async () => {
    const members = normalizeGroupMembers([{ id: '111@lid' }, { id: '222@lid' }, { id: '5511999990000@s.whatsapp.net' }]);
    const lookup = vi.fn(async (lids: string[]) => {
      expect(lids).toEqual(['111@lid', '222@lid']);
      return [{ lid: '111@lid', pn: '5511888880000:0@s.whatsapp.net' }];
    });
    const out = await resolveLocalLidPhones(members, lookup);
    expect(out).toEqual([member('111', '5511888880000'), member('222'), member(null, '5511999990000')]);
    expect(members[0]!.phone).toBeNull();
  });

  it('não consulta quem já tem telefone nem chama o mapa sem pendentes', async () => {
    const lookup = vi.fn(async () => null);
    const members = [member('111', '5511888880000')];
    expect(await resolveLocalLidPhones(members, lookup)).toEqual(members);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('sem mapa disponível ou sem resultado: segue sem telefone', async () => {
    expect(await resolveLocalLidPhones([member('111')], undefined)).toEqual([member('111')]);
    expect(await resolveLocalLidPhones([member('111')], async () => null)).toEqual([member('111')]);
  });

  it('falha do mapa nunca derruba a leitura; bloco seguinte ainda resolve', async () => {
    const members = Array.from({ length: LOCAL_LID_LOOKUP_BATCH + 1 }, (_, i) => member(String(1000 + i)));
    const last = members[members.length - 1]!.lid!;
    const onError = vi.fn();
    const lookup = vi
      .fn<(lids: string[]) => Promise<{ lid: string; pn: string }[]>>()
      .mockRejectedValueOnce(new Error('store down'))
      .mockResolvedValueOnce([{ lid: `${last}@lid`, pn: '5511777770000@s.whatsapp.net' }]);
    const out = await resolveLocalLidPhones(members, lookup, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out.filter((m) => m.phone)).toEqual([member(last, '5511777770000')]);
    expect(out).toHaveLength(members.length);
  });

  it('consulta em blocos de 500, sem LID repetido', async () => {
    const members = [...Array.from({ length: 1200 }, (_, i) => member(String(5000 + i))), member('5000')];
    const lookup = vi.fn(async () => []);
    await resolveLocalLidPhones(members, lookup);
    expect(lookup.mock.calls.map((c) => (c as unknown as [string[]])[0].length)).toEqual([500, 500, 200]);
  });

  it('ignora par inválido (telefone não numérico, LID devolvido como telefone)', async () => {
    const out = await resolveLocalLidPhones([member('111'), member('222')], async () => [
      { lid: '111@lid', pn: '111@lid' },
      { lid: '222@lid', pn: 'abc@s.whatsapp.net' },
    ]);
    expect(out).toEqual([member('111'), member('222')]);
  });
});
