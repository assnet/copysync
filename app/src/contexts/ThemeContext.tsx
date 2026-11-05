import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider, CssBaseline, type PaletteMode } from '@mui/material';
import { buildTheme } from '@/theme/theme';
import {
  DARK_SCHEME_QUERY,
  readStoredThemePreference,
  resolveThemeMode,
  storeThemePreference,
  systemPrefersDark,
  type ThemePreference,
} from './themePreference';

export type { ThemePreference } from './themePreference';

interface ThemeContextValue {
  /** Modo aplicado (já resolvido quando a preferência é `system`). */
  mode: PaletteMode;
  /** Escolha do usuário: sistema, claro ou escuro. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredThemePreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(query.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Safari < 14
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    storeThemePreference(next);
    setPreferenceState(next);
  }, []);

  const mode = resolveThemeMode(preference, prefersDark);
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const value = useMemo(() => ({ mode, preference, setPreference }), [mode, preference, setPreference]);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  return (
    <ThemeCtx.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeCtx.Provider>
  );
}

export function useColorMode(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useColorMode deve ser usado dentro de ColorModeProvider');
  return ctx;
}
