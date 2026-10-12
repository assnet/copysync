/**
 * Identidade visual do painel — único lugar onde o nome do produto aparece
 * em código. Componentes importam daqui; nunca repetem a string.
 * Assets derivados ficam em `public/assets/brand/` (ver docs/rebranding-copysync.md).
 */
export const APP_NAME = 'CopySync';

export const BRAND_ASSETS = {
  /** Logo quadrado 512 px com fundo branco — usado em tiles de UI. */
  logo: '/assets/brand/logo-512.png',
  icon192: '/assets/brand/icon-192.png',
  icon512: '/assets/brand/icon-512.png',
} as const;
