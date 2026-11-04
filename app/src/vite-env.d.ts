/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Base do redirect da página de venda; ausente → sem link externo (`features/plans/checkout.ts`). */
  readonly VITE_BILLING_CHECKOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versão do painel, injetada pelo Vite a partir do package.json. */
declare const __APP_VERSION__: string;
