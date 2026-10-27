/**
 * ML cookie lists — parity with `extension/src/background/constants.ts`.
 * Real cookie names confirmed by F0 spike (2026-10-27).
 */

/** Identity cookies captured by the extension and sent to the API. */
export const ML_SESSION_COOKIES = ['ssid', 'orguseridp', 'orgnickp', 'orguserid'] as const;

/** Temporary cookies obtained via server bootstrap (never sent by extension). */
export const ML_TEMP_COOKIES = ['_csrf', '_d2id', '_mldataSessionId', 'nsa_rotok'] as const;

/** Union: all cookies the server may hold. */
export const ML_SERVER_COOKIES = [...ML_SESSION_COOKIES, ...ML_TEMP_COOKIES] as const;

/** Sliding TTL for ExtensionSession (renewed on heartbeat). */
export const EXT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Absolute TTL ceiling — session cannot be extended past this. */
export const EXT_SESSION_ABSOLUTE_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Grace period: previous token hash remains valid after rotation. */
export const EXT_TOKEN_GRACE_SECONDS = 60;

/** Minimum interval between heartbeat writes. */
export const EXT_HEARTBEAT_MIN_INTERVAL_SECONDS = 50;
