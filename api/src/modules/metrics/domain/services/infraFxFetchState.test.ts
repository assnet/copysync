import { describe, expect, it } from 'vitest';
import {
  fxFetchFailedToday,
  isFxFetchDue,
  parseInfraFxFetchState,
  serializeInfraFxFetchState,
  startFxFetchAttempt,
  type InfraFxFetchState,
} from './infraFxFetchState';

const at = (t: string) => new Date(`2026-11-12T${t}Z`);
const failed = (attempts: number, last: string): InfraFxFetchState => ({ referenceDay: '2026-11-12', attempts, lastAttemptAt: at(last), ok: false });

describe('agenda da cotação automática', () => {
  it('só a partir de 16h30 UTC, 1×/dia', () => {
    expect(isFxFetchDue(null, at('16:29:59'))).toBe(false);
    expect(isFxFetchDue(null, at('16:30:00'))).toBe(true);
    expect(isFxFetchDue({ ...failed(1, '16:31:00'), ok: true }, at('23:00:00'))).toBe(false);
    // estado de ontem não conta
    expect(isFxFetchDue({ referenceDay: '2026-11-11', attempts: 2, lastAttemptAt: at('00:00:00'), ok: false }, at('16:31:00'))).toBe(true);
  });

  it('falhou: no máximo uma nova tentativa, 1 h depois', () => {
    expect(isFxFetchDue(failed(1, '16:31:00'), at('17:30:59'))).toBe(false);
    expect(isFxFetchDue(failed(1, '16:31:00'), at('17:31:00'))).toBe(true);
    expect(isFxFetchDue(failed(2, '17:31:00'), at('23:59:00'))).toBe(false);
  });

  it('tentativa conta antes da busca e reinicia no dia novo', () => {
    expect(startFxFetchAttempt(null, at('16:31:00'))).toEqual(failed(1, '16:31:00'));
    expect(startFxFetchAttempt(failed(1, '16:31:00'), at('17:31:00'))).toEqual(failed(2, '17:31:00'));
    expect(startFxFetchAttempt({ ...failed(2, '17:00:00'), referenceDay: '2026-11-11' }, at('16:31:00')).attempts).toBe(1);
  });

  it('falhou hoje só com tentativa do dia sem sucesso', () => {
    expect(fxFetchFailedToday(null, at('18:00:00'))).toBe(false);
    expect(fxFetchFailedToday(failed(1, '16:31:00'), at('18:00:00'))).toBe(true);
    expect(fxFetchFailedToday({ ...failed(1, '16:31:00'), ok: true }, at('18:00:00'))).toBe(false);
    expect(fxFetchFailedToday({ ...failed(2, '16:31:00'), referenceDay: '2026-11-11' }, at('18:00:00'))).toBe(false);
  });

  it('JSON gravado ida e volta; formato inválido = null', () => {
    const s = failed(1, '16:31:00');
    expect(parseInfraFxFetchState(JSON.parse(JSON.stringify(serializeInfraFxFetchState(s))))).toEqual(s);
    expect(parseInfraFxFetchState(null)).toBeNull();
    expect(parseInfraFxFetchState({ ...serializeInfraFxFetchState(s), attempts: -1 })).toBeNull();
    expect(parseInfraFxFetchState({ ...serializeInfraFxFetchState(s), lastAttemptAt: 'x' })).toBeNull();
    expect(parseInfraFxFetchState({ referenceDay: '2026-11-12', attempts: 1, lastAttemptAt: s.lastAttemptAt.toISOString() })).toBeNull();
  });
});
