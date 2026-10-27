import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PrivacyProvider, readStoredFlags, useBlur, usePrivacy } from './PrivacyContext';
import { Blurred } from './components/Blurred';

const wrapper = ({ children }: { children: ReactNode }) => <PrivacyProvider>{children}</PrivacyProvider>;

beforeEach(() => localStorage.clear());

describe('PrivacyProvider', () => {
  it('liga/desliga flag, tela inteira e tudo; persiste no navegador', () => {
    const { result } = renderHook(() => usePrivacy(), { wrapper });
    expect(result.current.active).toBe(false);

    act(() => result.current.setFlag('offers.groupNames', true));
    expect(result.current.isBlurred('offers.groupNames')).toBe(true);
    expect(result.current.active).toBe(true);
    expect([...readStoredFlags()]).toEqual(['offers.groupNames']);

    act(() => result.current.setScreen('offers', true));
    expect(result.current.flags.size).toBe(4);

    act(() => result.current.setAll(false));
    expect(result.current.active).toBe(false);
    expect(readStoredFlags().size).toBe(0);
  });

  it('ignora lixo salvo no navegador', () => {
    localStorage.setItem('privacy.blur', JSON.stringify(['offers.groupNames', 'invalida', 42]));
    expect([...readStoredFlags()]).toEqual(['offers.groupNames']);
    localStorage.setItem('privacy.blur', '{not json');
    expect(readStoredFlags().size).toBe(0);
  });

  it('useBlur fora do provider devolve false (prévias e testes não quebram)', () => {
    const { result } = renderHook(() => useBlur('offers.groupNames'));
    expect(result.current).toBe(false);
  });
});

describe('Blurred', () => {
  it('desligado devolve o filho puro; ligado envolve com desfoque e sem seleção', () => {
    const { rerender } = render(<Blurred when={false}><span>Grupo X</span></Blurred>);
    expect(screen.getByText('Grupo X').closest('[data-blurred]')).toBeNull();
    rerender(<Blurred when><span>Grupo X</span></Blurred>);
    const wrap = screen.getByText('Grupo X').closest('[data-blurred]') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(getComputedStyle(wrap).filter).toContain('blur');
  });
});
