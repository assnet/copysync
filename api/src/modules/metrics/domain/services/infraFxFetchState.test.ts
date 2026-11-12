import { describe, expect, it } from 'vitest';
import {
  fxFetchFailedToday,
  INFRA_FX_MISSING_AFTER_DAYS,
  isFxFetchDue,
  isFxRateMissing,
  parseInfraFxFetchState,
  serializeInfraFxFetchState,
  startFxFetchAttempt,
  type InfraFxFetchState,
} from './infraFxFetchState';

const at = (t: string) => new Date(`2026-11-12T${t}Z`);
/** Cotação gravada de ontem (recente). */
const RECENT = new Date('2026-11-11T00:00:00Z');
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const failed = (attempts: number, last: string): InfraFxFetchState => ({ referenceDay: '2026-11-12', attempts, lastAttemptAt: at(last), ok: false });

describe('agenda da cotação automática', () => {
  it('só a partir de 16h30 UTC, 1×/dia', () => {
    expect(isFxFetchDue(null, at('16:29:59'), RECENT)).toBe(false);
    expect(isFxFetchDue(null, at('16:30:00'), RECENT)).toBe(true);
    expect(isFxFetchDue({ ...failed(1, '16:31:00'), ok: true }, at('23:00:00'), RECENT)).toBe(false);
    // estado de ontem não conta
    expect(isFxFetchDue({ referenceDay: '2026-11-11', attempts: 2, lastAttemptAt: at('00:00:00'), ok: false }, at('16:31:00'), RECENT)).toBe(true);
  });

  it('falhou: no máximo uma nova tentativa, 1 h depois', () => {
    expect(isFxFetchDue(failed(1, '16:31:00'), at('17:30:59'), RECENT)).toBe(false);
    expect(isFxFetchDue(failed(1, '16:31:00'), at('17:31:00'), RECENT)).toBe(true);
    expect(isFxFetchDue(failed(2, '17:31:00'), at('23:59:00'), RECENT)).toBe(false);
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

  it('sem cotação gravada: busca já, em qualquer horário', () => {
    expect(isFxFetchDue(null, at('03:00:00'), null)).toBe(true);
    expect(isFxRateMissing(null, at('03:00:00'))).toBe(true);
  });

  it('cotação recente: só após 16h30; antiga (> 4 dias): já', () => {
    expect(INFRA_FX_MISSING_AFTER_DAYS).toBe(4);
    // 2026-11-08 00:00 → 2026-11-12 03:00 = 4 dias e 3 h
    expect(isFxFetchDue(null, at('03:00:00'), day('2026-11-08'))).toBe(true);
    // 2026-11-08 00:00 → 2026-11-11 23:59 = 3 dias e 23 h
    expect(isFxRateMissing(day('2026-11-08'), new Date('2026-11-11T23:59:00Z'))).toBe(false);
    expect(isFxFetchDue(null, at('03:00:00'), day('2026-11-09'))).toBe(false);
    expect(isFxFetchDue(null, at('16:30:00'), day('2026-11-09'))).toBe(true);
  });

  it('busca fora do horário: mesmo limite de tentativas e espera de 1 h', () => {
    expect(isFxFetchDue(failed(1, '03:00:00'), at('03:59:00'), null)).toBe(false);
    expect(isFxFetchDue(failed(1, '03:00:00'), at('04:00:00'), null)).toBe(true);
    expect(isFxFetchDue(failed(2, '04:00:00'), at('12:00:00'), null)).toBe(false);
    expect(isFxFetchDue({ ...failed(1, '03:00:00'), ok: true }, at('12:00:00'), null)).toBe(false);
    expect(startFxFetchAttempt(failed(1, '03:00:00'), at('04:00:00')).attempts).toBe(2);
  });

  it('a rodada das 16h30 vale depois da busca fora do horário (com ou sem sucesso), 1× só', () => {
    expect(isFxFetchDue({ ...failed(1, '03:00:00'), ok: true }, at('16:30:00'), RECENT)).toBe(true);
    expect(isFxFetchDue(failed(2, '04:00:00'), at('16:30:00'), null)).toBe(true);
    expect(startFxFetchAttempt(failed(2, '04:00:00'), at('16:30:00')).attempts).toBe(1);
    // rodada das 16h30 feita: nada mais no dia, mesmo se a fonte devolveu cotação antiga
    expect(isFxFetchDue({ ...failed(1, '16:31:00'), ok: true }, at('20:00:00'), day('2026-11-01'))).toBe(false);
  });
});
