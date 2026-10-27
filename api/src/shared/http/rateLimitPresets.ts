import type { RateLimitOptions } from '@fastify/rate-limit';

export const rateLimitPresets = {
  lifecycle: {
    max: 30,
    timeWindow: '1 minute',
  },
  extensionAuth: {
    max: 10,
    timeWindow: '1 minute',
  },
  extensionSync: {
    max: 60,
    timeWindow: '1 minute',
  },
  general: {
    max: 120,
    timeWindow: '1 minute',
  },
} as const satisfies Record<string, RateLimitOptions>;
