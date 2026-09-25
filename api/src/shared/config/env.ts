import path from 'path';
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

  // Mídia enviada: pasta das partes em upload. Sem valor, derivada de STORAGE_PATH (abaixo).
  MEDIA_UPLOAD_TMP_PATH: z.string().min(1).optional(),
  // Mídia enviada: tamanho de cada parte do upload (8 MiB).
  MEDIA_UPLOAD_CHUNK_BYTES: z.coerce.number().int().positive().default(8_388_608),
  // Mídia enviada: upload parado há mais que isso é apagado pela varredura.
  MEDIA_UPLOAD_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  // Mídia enviada: uploads abertos por usuário (igual ao lote).
  MEDIA_UPLOAD_MAX_OPEN_PER_USER: z.coerce.number().int().positive().default(30),
  // Mídia enviada: sem padrão fixo — sem valor, relativos ao tamanho do disco (diskBudget).
  MEDIA_UPLOAD_MAX_OPEN_BYTES: z.coerce.number().int().positive().optional(),
  MEDIA_DISK_RESERVE_BYTES: z.coerce.number().int().nonnegative().optional(),
  // Mídia enviada: folga mínima no /tmp para o processamento (256 MiB).
  MEDIA_TMP_RESERVE_BYTES: z.coerce.number().int().nonnegative().default(268_435_456),
  // Mídia enviada: limites por tipo, em decimal como os do WhatsApp.
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(16_000_000),
  MEDIA_MAX_INLINE_VIDEO_BYTES: z.coerce.number().int().positive().default(180_000_000),
  MEDIA_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(180_000_000),
  MEDIA_MAX_VOICE_SECONDS: z.coerce.number().int().positive().default(900),
  MEDIA_MAX_FILES_PER_BATCH: z.coerce.number().int().positive().default(30),
  // Mídia enviada: fila de envio ao WhatsApp (total, por sessão e tamanho por sessão).
  MEDIA_SEND_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MEDIA_SEND_PER_SESSION: z.coerce.number().int().positive().default(2),
  MEDIA_SEND_QUEUE_MAX_PER_SESSION: z.coerce.number().int().positive().default(100),
  // Mídia enviada: processos ffmpeg/ffprobe simultâneos.
  MEDIA_PROCESS_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // Mídia enviada: ociosidade do socket no upload ao WhatsApp — não é tempo total.
  MEDIA_UPLOAD_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Mídia enviada: janela e teto do registro de eco da própria mídia.
  MEDIA_ECHO_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  MEDIA_ECHO_MAX_PER_SESSION: z.coerce.number().int().positive().default(200),
  // Mídia enviada: no boot, PENDING antigo vira FAILED. Desligado por padrão porque o
  // .env local aponta para o banco de produção — ligar só no ambiente que envia de fato.
  MEDIA_PENDING_RECOVERY_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MEDIA_PENDING_STALE_MINUTES: z.coerce.number().int().positive().default(60),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
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

/**
 * Pasta das partes em upload — irmã de STORAGE_PATH quando não configurada.
 *
 * Mesmo disco (a promoção para a pasta de mídia é um `rename` atômico) e **fora** da raiz
 * estática, que serviria o upload incompleto. Na Render: `/var/data/media-uploads`; em
 * desenvolvimento, `api/media-uploads`.
 */
function mediaUploadTmpPath(e: z.infer<typeof envSchema>): string {
  return e.MEDIA_UPLOAD_TMP_PATH ?? path.join(path.dirname(e.STORAGE_PATH), 'media-uploads');
}

const envWithDerivedSchema = envSchema.transform((e) => ({
  ...e,
  REACTION_ECHO_MAX_PER_SESSION: reactionEchoCap(e),
  MEDIA_UPLOAD_TMP_PATH: mediaUploadTmpPath(e),
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
