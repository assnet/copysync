import os from 'os';
import { randomBytes } from 'crypto';
import { env } from './env';

/** Entrada da identidade: `WORKER_ID` (já validado em `env`) e `HOSTNAME` cru do processo. */
export interface WorkerIdentityEnv {
  WORKER_ID?: string;
  HOSTNAME?: string;
}

const NONCE_BYTES = 4; // 8 caracteres hex

/**
 * Identidade do processo no lease de sessão (pura).
 *
 * `WORKER_ID` definido vale como veio (trim). Vazio: `${HOSTNAME ?? host}-${pid}-${nonce8}`.
 * O nonce torna cada boot único — um restart no mesmo host/pid não herda o lease do anterior.
 */
export function resolveWorkerId(
  e: WorkerIdentityEnv,
  host: string,
  pid: number,
  random: (size: number) => Buffer = randomBytes,
): string {
  const explicit = e.WORKER_ID?.trim();
  if (explicit) return explicit;
  const hostname = e.HOSTNAME?.trim() || host;
  const nonce = random(NONCE_BYTES).toString('hex').slice(0, NONCE_BYTES * 2);
  return `${hostname}-${pid}-${nonce}`;
}

let current: string | undefined;

/** Id deste processo, calculado uma vez por boot. */
export function currentWorkerId(): string {
  current ??= resolveWorkerId(
    { WORKER_ID: env.WORKER_ID, HOSTNAME: process.env['HOSTNAME'] },
    os.hostname(),
    process.pid,
  );
  return current;
}
