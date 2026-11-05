import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorModeProvider, useColorMode } from './ThemeContext';
import { ThemeModeSelector } from '@/components/ThemeModeSelector';
import { THEME_PREFERENCE_STORAGE_KEY, parseThemePreference, resolveThemeMode } from './themePreference';

type Listener = (e: MediaQueryListEvent) => void;

function mockMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('dark') ? dark : false; },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    dispatchEvent: () => true,
  }));
  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
  };
}

function Probe() {
  const { mode, preference } = useColorMode();
  return <span data-testid="probe">{`${preference}:${mode}`}</span>;
}

const renderProvider = () => render(<ColorModeProvider><Probe /><ThemeModeSelector /></ColorModeProvider>);

describe('tema: preferência sistema/claro/escuro', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('sem valor salvo usa sistema e segue matchMedia, reagindo à mudança', () => {
    const media = mockMatchMedia(true);
    renderProvider();
    expect(screen.getByTestId('probe')).toHaveTextContent('system:dark');
    act(() => media.setDark(false));
    expect(screen.getByTestId('probe')).toHaveTextContent('system:light');
  });

  it('valor antigo salvo (light/dark) é respeitado e ignora o sistema', () => {
    const media = mockMatchMedia(true);
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'light');
    renderProvider();
    expect(screen.getByTestId('probe')).toHaveTextContent('light:light');
    act(() => media.setDark(true));
    expect(screen.getByTestId('probe')).toHaveTextContent('light:light');
  });

  it('seletor grava a escolha e volta para sistema', async () => {
    mockMatchMedia(false);
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'dark');
    renderProvider();
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tema: Escuro' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Sistema/ }));
    expect(screen.getByTestId('probe')).toHaveTextContent('system:light');
    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('system');
  });

  it('valores inválidos caem para sistema', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('azul')).toBe('system');
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });
});
