import { BLOCKED_FIELDS } from '../constants.js';

/**
 * `assertNoSecrets` — strip or reject payloads containing sensitive fields.
 * Prevents ML cookies, auth headers, and CSRF tokens from leaking through
 * the channel to the panel.
 */

const BLOCKED_SET = new Set(BLOCKED_FIELDS.map(f => f.toLowerCase()));

const sanitizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_SET.has(key.toLowerCase())) continue;
    result[key] = sanitizeValue(val);
  }
  return result;
};

export const assertNoSecrets = <T>(payload: T): T =>
  sanitizeValue(payload) as T;
