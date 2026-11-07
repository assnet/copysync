/**
 * Tipos de evento do ciclo de vida da extensão (coluna `type` de `extension_lifecycle_events` e
 * `payload.event` do outbox `extension.lifecycle`). Lista para a central: docs/extensao-navegador.md,
 * seção "Eventos para a central".
 */
export const LIFECYCLE_EVENT = {
  STORE_CLICK: 'STORE_CLICK',
  INSTALL: 'INSTALL',
  UPDATE: 'UPDATE',
  STARTUP: 'STARTUP',
  LINKED: 'LINKED',
  UNINSTALL: 'UNINSTALL',
  UNINSTALL_FEEDBACK: 'UNINSTALL_FEEDBACK',
} as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT)[keyof typeof LIFECYCLE_EVENT];

/** Sinais que a rota pública aceita da extensão. STARTUP fica só no banco local (volume). */
export const PUBLIC_SIGNAL_TYPES = ['INSTALL', 'UPDATE', 'STARTUP'] as const;
export type PublicSignalType = (typeof PUBLIC_SIGNAL_TYPES)[number];

/** Eventos que vão ao outbox quando há `clientKey`. */
export const HUB_FORWARDED_EVENTS: ReadonlySet<LifecycleEventType> = new Set<LifecycleEventType>([
  'STORE_CLICK', 'INSTALL', 'UPDATE', 'LINKED', 'UNINSTALL', 'UNINSTALL_FEEDBACK',
]);

/** `type` do envelope do outbox para todos os eventos do ciclo de vida. */
export const HUB_LIFECYCLE_ENVELOPE_TYPE = 'extension.lifecycle';

export const STORE_CLICK_SOURCES = ['settings', 'ml_wizard', 'onboarding'] as const;
export type StoreClickSource = (typeof STORE_CLICK_SOURCES)[number];

/** Clique repetido do mesmo usuário dentro desta janela não vira evento novo. */
export const STORE_CLICK_DEDUPE_WINDOW_MS = 60_000;
/** Clique só é atribuído à primeira vinculação feita até 7 dias depois. */
export const STORE_CLICK_ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60_000;

export const UNINSTALL_REASONS = [
  'not_working', 'hard_to_use', 'slow', 'fear_of_block', 'no_longer_needed', 'price', 'other_tool', 'other',
] as const;
export type UninstallReason = (typeof UNINSTALL_REASONS)[number];
export const UNINSTALL_COMMENT_MAX = 500;

/** ID de extensão do Chrome: 32 letras a–p. */
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;
