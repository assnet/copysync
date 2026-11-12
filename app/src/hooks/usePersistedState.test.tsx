import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearDevicePersisted, clearPersisted, readPersisted, usePersistedState, writePersisted } from './usePersistedState';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('usePersistedState', () => {
  it('começa do inicial, grava a cada mudança e recupera numa nova montagem (reload)', () => {
    const a = renderHook(() => usePersistedState('offers.form', { url: '' }));
    expect(a.result.current[0]).toEqual({ url: '' });
    act(() => a.result.current[1]({ url: 'https://x' }));
    a.unmount();

    const b = renderHook(() => usePersistedState('offers.form', { url: '' }));
    expect(b.result.current[0]).toEqual({ url: 'https://x' });
  });

  it('clear() volta ao inicial e apaga o salvo', () => {
    const h = renderHook(() => usePersistedState('k', 1));
    act(() => h.result.current[1](5));
    act(() => h.result.current[2]());
    expect(h.result.current[0]).toBe(1);
    expect(readPersisted('k')).toBeUndefined();
  });

  it('clear() sem mudança de estado não engole a próxima gravação', () => {
    const h = renderHook(() => usePersistedState('k', 1));
    act(() => h.result.current[2]());
    act(() => h.result.current[1](7));
    expect(readPersisted('k')).toBe(7);
    act(() => h.result.current[1](8));
    act(() => h.result.current[2]());
    expect(readPersisted('k')).toBeUndefined();
    act(() => h.result.current[1](9));
    expect(readPersisted('k')).toBe(9);
  });

  it('versão diferente ou JSON inválido descartam o salvo', () => {
    writePersisted('k', { a: 1 }, { version: 1 });
    expect(readPersisted('k', { version: 2 })).toBeUndefined();
    sessionStorage.setItem('ui.k', '{broken');
    expect(readPersisted('k')).toBeUndefined();
  });

  it('serialize/deserialize permitem Map; escopo browser usa localStorage', () => {
    const opts = {
      scope: 'browser' as const,
      serialize: (m: Map<string, number>) => [...m],
      deserialize: (raw: unknown) => new Map(raw as [string, number][]),
    };
    const h = renderHook(() => usePersistedState('m', new Map<string, number>(), opts));
    act(() => h.result.current[1](new Map([['a', 1]])));
    expect(localStorage.getItem('ui.m')).toContain('"a"');
    const again = renderHook(() => usePersistedState('m', new Map<string, number>(), opts));
    expect(again.result.current[0].get('a')).toBe(1);
    clearPersisted('m', 'browser');
    expect(localStorage.getItem('ui.m')).toBeNull();
  });

  describe('escopo device (sobrevive a fechar o navegador no celular)', () => {
    const login = (userId: string, tenantId: string) => {
      localStorage.setItem('authUser', JSON.stringify({ id: userId }));
      localStorage.setItem('activeTenantId', tenantId);
    };
    const device = { scope: 'device' as const };

    it('grava no localStorage e volta sem o sessionStorage (aba descartada)', () => {
      login('u1', 't1');
      const h = renderHook(() => usePersistedState('offers.form', { url: '' }, device));
      act(() => h.result.current[1]({ url: 'https://x' }));
      sessionStorage.clear();
      const again = renderHook(() => usePersistedState('offers.form', { url: '' }, device));
      expect(again.result.current[0]).toEqual({ url: 'https://x' });
    });

    it('outro usuário ou tenant não vê o rascunho; expirado é descartado', () => {
      login('u1', 't1');
      writePersisted('k', 'rascunho', device);
      login('u2', 't1');
      expect(readPersisted('k', device)).toBeUndefined();
      login('u1', 't1');
      writePersisted('k', 'rascunho', device);
      login('u1', 't2');
      expect(readPersisted('k', device)).toBeUndefined();
      login('u1', 't1');
      writePersisted('k', 'rascunho', device);
      expect(readPersisted('k', { ...device, maxAgeMs: -1 })).toBeUndefined();
      expect(localStorage.getItem('ui.k')).toBeNull();
    });

    it('aproveita o rascunho antigo da aba; logout apaga só os rascunhos com dono', () => {
      login('u1', 't1');
      writePersisted('old', 'da aba');
      expect(readPersisted('old', device)).toBe('da aba');
      writePersisted('d', 1, device);
      writePersisted('pref', 'tema', { scope: 'browser' });
      clearDevicePersisted();
      expect(localStorage.getItem('ui.d')).toBeNull();
      expect(localStorage.getItem('ui.pref')).not.toBeNull();
    });
  });
});
