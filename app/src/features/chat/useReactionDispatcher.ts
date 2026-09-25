import { useEffect, useRef } from 'react';
import { reactionDispatcher, type ReactionDispatchEvent } from './reactionDispatcher';

/**
 * Adaptador React do despachante de reações: inscreve enquanto montado.
 * Desmontar só cancela a inscrição — os envios em espera seguem no horário (design §8).
 */
export function useReactionDispatcher(onEvent: (event: ReactionDispatchEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  useEffect(() => reactionDispatcher.subscribe((event) => handler.current(event)), []);
  return reactionDispatcher.enqueue;
}
