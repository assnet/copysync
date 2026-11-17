import { describe, expect, it } from 'vitest';
import { SHARED_KEYS, mergeSharedEntitlements } from './sharedEntitlements';

const W = 'whatsapp_sessions';
const T = 'telegram_sessions';

describe('mergeSharedEntitlements', () => {
  it('chaves compartilhadas', () => {
    expect(SHARED_KEYS).toEqual([W, T]);
  });
  it('maior vence por chave; outras chaves são ignoradas', () => {
    expect(mergeSharedEntitlements([{ [W]: 1, [T]: 2, monitored_groups: 9 }, { [W]: 2, [T]: 0 }])).toEqual({ [W]: 2, [T]: 2 });
  });
  it('null (ilimitado) vence tudo, em qualquer ordem', () => {
    expect(mergeSharedEntitlements([{ [W]: null }, { [W]: 5 }])).toEqual({ [W]: null });
    expect(mergeSharedEntitlements([{ [W]: 5 }, { [W]: null }])).toEqual({ [W]: null });
  });
  it('produto ativo sem plano (legado ilimitado) = não grava', () => {
    expect(mergeSharedEntitlements([{ [W]: 1, [T]: 0 }, null])).toBeNull();
  });
  it('sem produto ou chave ausente: fica de fora; booleano ignorado', () => {
    expect(mergeSharedEntitlements([])).toEqual({});
    expect(mergeSharedEntitlements([{ [W]: 1 }, { [T]: true }])).toEqual({ [W]: 1 });
  });
});
