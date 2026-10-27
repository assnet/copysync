/**
 * Relógio do servidor no painel. Contagens regressivas sobre horários do servidor (ex.:
 * `notBefore` dos envios) usam `serverNow()`, não `Date.now()`: o relógio do computador do
 * usuário pode estar segundos ou minutos fora.
 *
 * Cada resposta da API traz `X-Server-Time` (ms). A diferença é estimada pelo ponto médio da
 * ida e volta (NTP simplificado); vale a amostra de menor latência entre as recentes, que é a
 * de menor erro.
 */

const MAX_SAMPLES = 8;

interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

let samples: ClockSample[] = [];

export function recordServerTime(serverMs: number, sentAtMs: number, receivedAtMs: number): void {
  if (!Number.isFinite(serverMs) || serverMs <= 0 || receivedAtMs < sentAtMs) return;
  const rttMs = receivedAtMs - sentAtMs;
  samples.push({ offsetMs: serverMs - (sentAtMs + receivedAtMs) / 2, rttMs });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

/** Servidor − local, em ms. 0 até a primeira resposta. */
export function serverClockOffset(): number {
  if (samples.length === 0) return 0;
  return samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs;
}

export function serverNow(): number {
  return Date.now() + serverClockOffset();
}

/** Converte um horário do servidor (ms) para o relógio local, para exibir ao usuário. */
export function serverToLocal(serverMs: number): Date {
  return new Date(serverMs - serverClockOffset());
}

export function resetServerClock(): void {
  samples = [];
}
