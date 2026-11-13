import { describe, expect, it } from 'vitest';
import {
  formatClock, formatDuration, markDone, markUndone, pickNext, recordPlayback, recordView, resumeAt, sanitize, statsOf, statusOf,
} from './progress';

const IDS = ['a', 'b', 'c'];

describe('progresso das aulas', () => {
  it('aula sem registro é nova e não retoma', () => {
    expect(statusOf(undefined)).toBe('new');
    expect(resumeAt(undefined)).toBe(0);
  });

  it('parar no meio vira "em andamento" e guarda o ponto', () => {
    const m = recordPlayback(recordView({}, 'a', 1), 'a', 120, 600, 2);
    expect(statusOf(m.a)).toBe('inProgress');
    expect(resumeAt(m.a)).toBe(120);
    expect(m.a.ratio).toBeCloseTo(0.2);
  });

  it('abrir e fechar logo (< 15 s) não cria retomada', () => {
    const m = recordPlayback({}, 'a', 5, 600, 1);
    expect(resumeAt(m.a)).toBe(0);
  });

  it('90% do vídeo conclui sozinho; concluída não retoma', () => {
    const m = recordPlayback({}, 'a', 550, 600, 1);
    expect(m.a.done).toBe(true);
    expect(statusOf(m.a)).toBe('done');
    expect(resumeAt(m.a)).toBe(0);
  });

  it('reassistir trecho inicial de aula concluída mantém o ponto e a conclusão', () => {
    let m = recordPlayback({}, 'a', 590, 600, 1);
    m = recordPlayback(m, 'a', 30, 600, 2);
    expect(m.a.done).toBe(true);
    expect(m.a.position).toBe(590);
  });

  it('desmarcar zera ponto e conclusão', () => {
    const m = markUndone(markDone({}, 'a', 1), 'a', 2);
    expect(statusOf(m.a)).toBe('new');
  });

  it('próxima: em andamento mais recente, senão a primeira pendente, senão null', () => {
    let m = markDone({}, 'a', 1);
    expect(pickNext(IDS, m)?.id).toBe('b');
    m = recordPlayback(m, 'c', 100, 600, 5);
    expect(pickNext(IDS, m)).toEqual({ id: 'c', resume: 100 });
    m = markDone(markDone(m, 'b', 6), 'c', 7);
    expect(pickNext(IDS, m)).toBeNull();
  });

  it('estatísticas', () => {
    const m = recordPlayback(markDone({}, 'a', 1), 'b', 100, 600, 2);
    expect(statsOf(IDS, m)).toEqual({ total: 3, done: 1, inProgress: 1, percent: 33 });
  });

  it('sanitize descarta ids fora do catálogo e valores inválidos', () => {
    const out = sanitize({ a: { position: 'x', done: true, ratio: 7 }, zzz: { done: true } }, IDS);
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a).toMatchObject({ position: 0, done: true, ratio: 1 });
    expect(sanitize(null, IDS)).toEqual({});
  });

  it('formata duração e relógio', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(725)).toBe('12 min');
    expect(formatDuration(3900)).toBe('1 h 05 min');
    expect(formatClock(185)).toBe('3:05');
    expect(formatClock(3723)).toBe('1:02:03');
  });
});
