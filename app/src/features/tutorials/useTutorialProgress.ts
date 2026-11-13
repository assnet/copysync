import { useCallback, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { LESSONS } from './catalog';
import {
  markDone, markUndone, recordPlayback, recordView, sanitize, type ProgressMap,
} from './progress';

const KNOWN_IDS = LESSONS.map((l) => l.id);

/**
 * Progresso salvo neste navegador (`browser`: sobrevive a fechar o navegador e ao logout, é
 * lembrança de estudo, não rascunho). A chave leva o usuário: contas diferentes no mesmo
 * navegador não misturam o histórico.
 */
export function useTutorialProgress(userId: string) {
  const [progress, setProgress, clear] = usePersistedState<ProgressMap>(
    `tutorials.progress.${userId || 'anon'}`,
    {},
    { scope: 'browser', version: 1, deserialize: (raw) => sanitize(raw, KNOWN_IDS) },
  );

  const view = useCallback((id: string) => setProgress((m) => recordView(m, id, Date.now())), [setProgress]);
  const playback = useCallback(
    (id: string, position: number, duration: number) =>
      setProgress((m) => recordPlayback(m, id, position, duration, Date.now())),
    [setProgress],
  );
  const toggleDone = useCallback(
    (id: string) => setProgress((m) => (m[id]?.done ? markUndone(m, id, Date.now()) : markDone(m, id, Date.now()))),
    [setProgress],
  );
  const finish = useCallback((id: string) => setProgress((m) => markDone(m, id, Date.now())), [setProgress]);

  return useMemo(() => ({ progress, view, playback, toggleDone, finish, reset: clear }), [progress, view, playback, toggleDone, finish, clear]);
}
