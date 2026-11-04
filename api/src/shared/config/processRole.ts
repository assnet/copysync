import { env, type Env } from './env';

/** Papel do processo: `http` (API), `worker` (sessões e jobs) ou `all` (os dois, sem Redis). */
export type ProcessRole = Env['PROCESS_ROLE'];

/** Papel deste processo, já validado em `env`. */
export function currentRole(): ProcessRole {
  return env.PROCESS_ROLE;
}

/** Abre sockets de sessão (engines locais, lease, bootstrap). */
export function runsSessions(role: ProcessRole): boolean {
  return role === 'worker' || role === 'all';
}

/** Atende a API HTTP completa (o `worker` só expõe `/health`). */
export function runsHttp(role: ProcessRole): boolean {
  return role === 'http' || role === 'all';
}

/** Conecta ao Redis. `all` nunca, mesmo com `REDIS_URL` (decisão D1). */
export function usesRedis(role: ProcessRole): boolean {
  return role !== 'all';
}
