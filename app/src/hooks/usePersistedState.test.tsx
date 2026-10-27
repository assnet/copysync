import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearPersisted, readPersisted, usePersistedState, writePersisted } from './usePersistedState';

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
});
