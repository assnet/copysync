/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** IDs da extensão aceitos pelo canal, separados por vírgula. */
  readonly VITE_EXTENSION_IDS?: string;
  /** Página da extensão na Chrome Web Store (padrão em features/extension/config.ts). */
  readonly VITE_EXTENSION_STORE_URL?: string;
  /** Reserva da site key do Turnstile (a fonte é GET /auth/login/config). Ver docs/seguranca-login.md. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versão do painel, injetada pelo Vite a partir do package.json. */
declare const __APP_VERSION__: string;
