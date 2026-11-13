import { useEffect, useRef, type RefObject } from 'react';
import { EMBED_ORIGIN, LISTENING_MESSAGE, PLAYER_STATE, parsePlayerMessage } from '../youtubeBridge';

const SAVE_EVERY_MS = 5000;

interface Handlers {
  onProgress: (lessonId: string, position: number, duration: number) => void;
  onEnded: (lessonId: string) => void;
}

/**
 * Escuta o iframe do player (ver `youtubeBridge.ts`) e salva o ponto a cada 5 s tocando, ao
 * pausar, ao terminar e ao fechar. `lessonKey` muda ao trocar de aula: reinicia a escuta.
 */
export function useLessonPlayer(frameRef: RefObject<HTMLIFrameElement | null>, lessonKey: string | null, handlers: Handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!lessonKey) return undefined;
    const latest = { position: 0, duration: 0, seen: false, dirty: false };
    let lastSave = 0;
    const flush = () => {
      if (!latest.dirty) return;
      latest.dirty = false;
      lastSave = Date.now();
      handlersRef.current.onProgress(lessonKey, latest.position, latest.duration);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== EMBED_ORIGIN || event.source !== frameRef.current?.contentWindow) return;
      const info = parsePlayerMessage(event.data);
      if (!info) return;
      latest.seen = true;
      if (info.duration !== undefined && info.duration > 0) latest.duration = info.duration;
      if (info.currentTime !== undefined) {
        latest.position = info.currentTime;
        latest.dirty = true;
      }
      if (info.state === PLAYER_STATE.ended) {
        flush();
        handlersRef.current.onEnded(lessonKey);
      } else if (info.state === PLAYER_STATE.paused || Date.now() - lastSave >= SAVE_EVERY_MS) {
        flush();
      }
    };
    window.addEventListener('message', onMessage);

    // O iframe só começa a falar depois do `listening`; repete até a primeira resposta.
    const hello = () => frameRef.current?.contentWindow?.postMessage(LISTENING_MESSAGE, EMBED_ORIGIN);
    const retry = window.setInterval(() => {
      if (latest.seen) window.clearInterval(retry);
      else hello();
    }, 500);
    const giveUp = window.setTimeout(() => window.clearInterval(retry), 20000);
    const frame = frameRef.current;
    frame?.addEventListener('load', hello);

    return () => {
      flush();
      window.removeEventListener('message', onMessage);
      window.clearInterval(retry);
      window.clearTimeout(giveUp);
      frame?.removeEventListener('load', hello);
    };
  }, [lessonKey, frameRef]);
}
