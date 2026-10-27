import type { StoredSettings } from '../background/store.js';

export type ThemePreference = StoredSettings['theme'];

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

/** Aplica a preferência no `<html data-theme>`; `system` remove o atributo e deixa o `prefers-color-scheme` decidir. */
export const applyTheme = (theme: ThemePreference): void => {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
};

export const nextTheme = (current: ThemePreference): ThemePreference =>
  ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

/** Chave i18n do rótulo/tooltip do botão de tema. */
export const themeLabelKey = (theme: ThemePreference): string => `popup_theme_${theme}`;

/** Paths SVG (24×24, stroke) para o ícone do botão de tema. */
export const themeIconPath = (theme: ThemePreference): string => {
  switch (theme) {
    case 'light':
      return 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
    case 'dark':
      return 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z';
    default:
      return 'M4 5h16v11H4zM8 20h8M12 16v4M12 5v11';
  }
};
