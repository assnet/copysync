export const ML_SESSION_COOKIES = ['ml_session', 'ml_usid', 'ml_csid'] as const;

export const ML_TEMP_COOKIES = ['ml_ga', '_ml_ci'] as const;

export const ML_SERVER_COOKIES = ['ml_sso'] as const;

export const EXT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const EXT_SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;

export const EXT_TOKEN_GRACE_SECONDS = 60;

export const EXT_HEARTBEAT_MIN_INTERVAL_SECONDS = 50;
