import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
  DATABASE_CONNECT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  DATABASE_CONNECT_RETRY_DELAY_MS: z.coerce.number().int().positive().default(3_000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  API_PREFIX: z.string().default('/api'),
  CORS_ORIGIN: z.string().default('*'),
  STORAGE_PATH: z.string().default('./storage'),
  BAILEYS_SYNC_FULL_HISTORY: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  [${e.path.join('.')}] ${e.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }

  return result.data;
}

export const env = loadEnv();
