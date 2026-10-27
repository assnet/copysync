/**
 * Cookie lists — mirror of `api/src/modules/extension/domain/constants.ts`.
 * Parity enforced by `vitest` (test compares both lists).
 *
 * NOTE: if the API file still has placeholder names (ml_session, ml_usid, etc.),
 * it must be updated to match these real ML cookie names (confirmed by F0 spike).
 */

/** Identity cookies captured by the extension and sent to the API. */
export const ML_SESSION_COOKIES = ['ssid', 'orguseridp', 'orgnickp', 'orguserid'] as const;

/** Temporary cookies obtained via server bootstrap (never sent by extension). */
export const ML_TEMP_COOKIES = ['_csrf', '_d2id', '_mldataSessionId', 'nsa_rotok'] as const;

/** Union: all cookies the server may hold. */
export const ML_SERVER_COOKIES = [...ML_SESSION_COOKIES, ...ML_TEMP_COOKIES] as const;

/** Fields that must NEVER appear in channel responses (assertNoSecrets). */
export const BLOCKED_FIELDS = [
  ...ML_SERVER_COOKIES,
  'csrf', 'x-csrf-token', 'cookies', 'authorization', 'cookie', 'set-cookie',
] as const;

export const SYNC_RATE_LIMIT_MS = 15 * 60 * 1000;
export const SYNC_DEBOUNCE_MS = 60 * 1000;
export const HEARTBEAT_ALARM = 'ext-heartbeat';
export const ML_SYNC_PENDING_ALARM = 'ml-session-pending';
export const ML_SYNC_RESERVE_ALARM = 'ml-session-reserve';
export const CHANNEL_VERSION = 1;
export const CHANNEL_NAME = 'cs-ext';
