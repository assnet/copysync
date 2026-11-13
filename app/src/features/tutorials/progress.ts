/**
 * Progresso das videoaulas: funções puras sobre um mapa `id → LessonProgress`.
 * Guardado só no navegador (`usePersistedState`, escopo `browser`); sem API, sem dado pessoal.
 */
export interface LessonProgress {
  /** Último ponto assistido (s), para retomar. */
  position: number;
  /** Duração do vídeo (s); 0 enquanto o player não informou. */
  duration: number;
  /** Maior fração já vista (0..1). */
  ratio: number;
  done: boolean;
  views: number;
  lastAt: number;
}

export type ProgressMap = Record<string, LessonProgress>;
export type LessonStatus = 'new' | 'inProgress' | 'done';

/** Fração do vídeo que conclui a aula sozinha. */
export const DONE_RATIO = 0.9;
/** Abaixo disso não vale retomar (o usuário só abriu e fechou). */
export const MIN_RESUME_SECONDS = 15;

const blank = (): LessonProgress => ({ position: 0, duration: 0, ratio: 0, done: false, views: 0, lastAt: 0 });
const touch = (map: ProgressMap, id: string, patch: (p: LessonProgress) => LessonProgress): ProgressMap => ({
  ...map,
  [id]: patch(map[id] ?? blank()),
});

export function recordView(map: ProgressMap, id: string, now: number): ProgressMap {
  return touch(map, id, (p) => ({ ...p, views: p.views + 1, lastAt: now }));
}

export function recordPlayback(map: ProgressMap, id: string, position: number, duration: number, now: number): ProgressMap {
  return touch(map, id, (p) => {
    const dur = duration > 0 ? duration : p.duration;
    const ratio = dur > 0 ? Math.max(p.ratio, Math.min(1, position / dur)) : p.ratio;
    // Aula concluída não perde o ponto ao reassistir só para rever um trecho
    const keepPosition = p.done && position < p.position;
    return {
      ...p,
      position: keepPosition ? p.position : Math.max(0, position),
      duration: dur,
      ratio,
      done: p.done || ratio >= DONE_RATIO,
      lastAt: now,
    };
  });
}

export function markDone(map: ProgressMap, id: string, now: number): ProgressMap {
  return touch(map, id, (p) => ({ ...p, done: true, ratio: Math.max(p.ratio, DONE_RATIO), lastAt: now }));
}

export function markUndone(map: ProgressMap, id: string, now: number): ProgressMap {
  return touch(map, id, (p) => ({ ...p, done: false, ratio: 0, position: 0, lastAt: now }));
}

export function statusOf(p: LessonProgress | undefined): LessonStatus {
  if (!p) return 'new';
  if (p.done) return 'done';
  return p.position >= MIN_RESUME_SECONDS || p.ratio > 0.02 ? 'inProgress' : 'new';
}

/** Segundo de retomada; 0 = começa do início. */
export function resumeAt(p: LessonProgress | undefined): number {
  if (!p || p.done || p.position < MIN_RESUME_SECONDS) return 0;
  return Math.floor(p.position);
}

/** Fração (0..1) para a barra do card: concluída = 1. */
export function barRatio(p: LessonProgress | undefined): number {
  if (!p) return 0;
  return p.done ? 1 : Math.min(1, p.ratio);
}

export interface NextLesson { id: string; resume: number }

/**
 * Próxima aula da trilha: a de `lastAt` mais recente entre as em andamento; senão a 1ª pendente
 * na ordem. `null` quando tudo foi concluído. Ordem é sugestão, nada é bloqueado.
 */
export function pickNext(orderedIds: readonly string[], map: ProgressMap): NextLesson | null {
  const started = orderedIds
    .filter((id) => statusOf(map[id]) === 'inProgress')
    .sort((a, b) => (map[b]?.lastAt ?? 0) - (map[a]?.lastAt ?? 0));
  const id = started[0] ?? orderedIds.find((x) => !map[x]?.done);
  return id ? { id, resume: resumeAt(map[id]) } : null;
}

export interface ProgressStats { total: number; done: number; inProgress: number; percent: number }

export function statsOf(orderedIds: readonly string[], map: ProgressMap): ProgressStats {
  const total = orderedIds.length;
  const done = orderedIds.filter((id) => map[id]?.done).length;
  const inProgress = orderedIds.filter((id) => statusOf(map[id]) === 'inProgress').length;
  return { total, done, inProgress, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** "3:05" / "1:02:03" — rótulo do ponto de retomada. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Descarta ids que saíram do catálogo e valores corrompidos do armazenamento. */
export function sanitize(raw: unknown, knownIds: readonly string[]): ProgressMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: ProgressMap = {};
  for (const id of knownIds) {
    const v = (raw as Record<string, Partial<LessonProgress> | undefined>)[id];
    if (!v || typeof v !== 'object') continue;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
    out[id] = {
      position: n(v.position),
      duration: n(v.duration),
      ratio: Math.min(1, n(v.ratio)),
      done: v.done === true,
      views: Math.floor(n(v.views)),
      lastAt: n(v.lastAt),
    };
  }
  return out;
}

