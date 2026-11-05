import type { ThemePreference } from '@/contexts/ThemeContext';

/** Textos do seletor de tema (sistema/claro/escuro). */
export const themeModeStrings = {
  tooltip: (current: string) => `Tema: ${current}`,
  menuLabel: 'Escolher tema',
  options: {
    system: 'Sistema',
    light: 'Claro',
    dark: 'Escuro',
  } satisfies Record<ThemePreference, string>,
  systemHint: 'Segue o tema do aparelho',
} as const;
