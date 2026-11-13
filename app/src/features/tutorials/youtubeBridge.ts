/**
 * Ponte com o player do YouTube SEM carregar script externo (o CSP só libera `frame-src`).
 * Com `enablejsapi=1`, o iframe responde por `postMessage` depois que a página manda `listening`:
 * chegam `infoDelivery` (tempo/duração/estado) e `onStateChange`. Só aceitamos mensagem do
 * `contentWindow` do nosso iframe e da origem do embed.
 */
export const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export const PLAYER_STATE = { ended: 0, playing: 1, paused: 2 } as const;

export function buildEmbedUrl(youtubeId: string, startAt: number, pageOrigin: string): string {
  const params = new URLSearchParams({
    autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1', enablejsapi: '1', origin: pageOrigin,
  });
  if (startAt > 0) params.set('start', String(Math.floor(startAt)));
  return `${EMBED_ORIGIN}/embed/${youtubeId}?${params.toString()}`;
}

export const LISTENING_MESSAGE = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

export interface PlayerInfo {
  currentTime?: number;
  duration?: number;
  state?: number;
}

/** Interpreta a mensagem crua do iframe; `null` quando não é do player. */
export function parsePlayerMessage(data: unknown): PlayerInfo | null {
  if (typeof data !== 'string') return null;
  let msg: { event?: string; info?: unknown };
  try {
    msg = JSON.parse(data) as typeof msg;
  } catch {
    return null;
  }
  if (msg.event === 'onStateChange' && typeof msg.info === 'number') return { state: msg.info };
  if ((msg.event === 'infoDelivery' || msg.event === 'initialDelivery') && msg.info && typeof msg.info === 'object') {
    const i = msg.info as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    const out: PlayerInfo = { currentTime: num(i.currentTime), duration: num(i.duration), state: num(i.playerState) };
    return out.currentTime === undefined && out.duration === undefined && out.state === undefined ? null : out;
  }
  return null;
}
