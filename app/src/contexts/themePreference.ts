import type { PaletteMode } from '@mui/material';

/** Preferência de tema do usuário: `system` segue o sistema operacional. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Chave já usada antes do modo sistema: valores antigos `light`/`dark` seguem válidos. */
export const THEME_PREFERENCE_STORAGE_KEY = 'colorMode';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function readStoredThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Armazenamento bloqueado: a escolha vale só nesta aba.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_SCHEME_QUERY).matches
    : false;
}

export function resolveThemeMode(preference: ThemePreference, prefersDark: boolean): PaletteMode {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}
