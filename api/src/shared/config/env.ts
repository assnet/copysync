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
  SESSION_BOOTSTRAP_ON_STARTUP: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  SESSION_BOOTSTRAP_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  BAILEYS_AUTH_FLUSH_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(750),
  BAILEYS_AUTH_PERSIST_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1_000),

  // Reações: janela em que o adapter reconhece o eco da própria reação enviada.
  REACTION_ECHO_TTL_MS: z.coerce.number().int().positive().default(120_000),
  // Reações: limite de envio por sessão (janela deslizante de 1 minuto).
  REACTION_MAX_PER_MINUTE: z.coerce.number().int().positive().default(30),
  // Reações: intervalo mínimo entre dois envios na mesma mensagem (menor que o do painel).
  REACTION_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(700),
});

/**
 * Teto de ids de eco guardados por sessão — derivado, nunca configurado à parte.
 *
 * Se fosse menor que o que pode estar em voo, descartar o mais antigo tiraria a marca de
 * um eco legítimo. O limite de envio garante no máximo REACTION_MAX_PER_MINUTE por minuto;
 * o fator 2 cobre a folga entre a janela deslizante do limite e o TTL.
 */
function reactionEchoCap(e: z.infer<typeof envSchema>): number {
  return e.REACTION_MAX_PER_MINUTE * Math.ceil(e.REACTION_ECHO_TTL_MS / 60_000) * 2;
}

const envWithDerivedSchema = envSchema.transform((e) => ({
  ...e,
  REACTION_ECHO_MAX_PER_SESSION: reactionEchoCap(e),
}));

export type Env = z.infer<typeof envWithDerivedSchema>;

function loadEnv(): Env {
  const result = envWithDerivedSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  [${e.path.join('.')}] ${e.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }

  return result.data;
}

export const env = loadEnv();
