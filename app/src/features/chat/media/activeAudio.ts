/**
 * Só um áudio toca por vez na conversa, como no WhatsApp: ao dar play em uma bolha, a que
 * estava tocando pausa. Registro único por aba — não sobrevive a recarga nem precisa.
 */

let current: HTMLMediaElement | null = null;

/** Chame antes de `play()`: pausa o áudio anterior e assume o lugar dele. */
export function claimActiveAudio(element: HTMLMediaElement): void {
  if (current && current !== element && !current.paused) current.pause();
  current = element;
}

/** Chame ao desmontar: libera o registro se ainda for deste elemento. */
export function releaseActiveAudio(element: HTMLMediaElement): void {
  if (current === element) current = null;
}
