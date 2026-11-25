import { describe, expect, it } from 'vitest';
import {
  isWatermarkKind,
  isWatermarkPosition,
  isWatermarkSize,
  OFFER_WATERMARK_LOGO_MAX_BYTES,
  validateWatermarkOpacity,
  validateWatermarkText,
} from './offerWatermarkRules';
import { activeWatermarkSource, changeWatermarkKind } from '../entities/OfferWatermark';

describe('validateWatermarkOpacity', () => {
  it.each([20, 55, 100])('%i aceita', (v) => expect(validateWatermarkOpacity(v)).toEqual({ kind: 'ok', value: v }));
  it.each([19, 101, 0, -5, 50.5, Number.NaN])('%s recusada', (v) =>
    expect(validateWatermarkOpacity(v)).toEqual({ kind: 'invalid' }),
  );
});

describe('validateWatermarkText', () => {
  it('trim e aceita até 32 caracteres (acentos e emoji contam 1)', () => {
    expect(validateWatermarkText('  Loja da Ana  ')).toEqual({ kind: 'ok', value: 'Loja da Ana' });
    expect(validateWatermarkText('é'.repeat(32))).toEqual({ kind: 'ok', value: 'é'.repeat(32) });
    expect(validateWatermarkText('🛒'.repeat(32)).kind).toBe('ok');
  });
  it.each([
    ['vazio', ''],
    ['só espaço', '   '],
    ['33 caracteres', 'a'.repeat(33)],
    ['quebra de linha', 'Loja\nAna'],
    ['quebra no fim', 'Loja Ana\n'],
    ['CR', 'Loja\rAna'],
    ['separador de linha', 'Loja\u2028Ana'],
    ['tab', 'Loja\tAna'],
    ['NUL', 'Loja\u0000Ana'],
  ])('%s recusado', (_, v) => expect(validateWatermarkText(v)).toEqual({ kind: 'invalid' }));
});

describe('enums e limites', () => {
  it('guardas de enum', () => {
    expect(isWatermarkKind('TEXT')).toBe(true);
    expect(isWatermarkKind('BOTH')).toBe(false);
    expect(isWatermarkPosition('CENTER')).toBe(true);
    expect(isWatermarkPosition('MIDDLE')).toBe(false);
    expect(isWatermarkSize('LARGE')).toBe(true);
    expect(isWatermarkSize('XL')).toBe(false);
  });
  it('logo ≤ 1 MiB', () => expect(OFFER_WATERMARK_LOGO_MAX_BYTES).toBe(1_048_576));
});

describe('tipo da marca', () => {
  const mark = { kind: 'IMAGE' as const, imageKey: 'wm/t1/logo.png', text: 'Loja da Ana' };

  it('trocar o tipo preserva logo e texto; só o tipo escolhido vale', () => {
    const asText = changeWatermarkKind(mark, 'TEXT');
    expect(asText).toEqual({ kind: 'TEXT', imageKey: 'wm/t1/logo.png', text: 'Loja da Ana' });
    expect(activeWatermarkSource(asText)).toEqual({ kind: 'TEXT', text: 'Loja da Ana' });
    const back = changeWatermarkKind(asText, 'IMAGE');
    expect(back).toEqual(mark);
    expect(activeWatermarkSource(back)).toEqual({ kind: 'IMAGE', imageKey: 'wm/t1/logo.png' });
  });

  it('tipo sem dado guardado → sem fonte (não cai no outro)', () => {
    expect(activeWatermarkSource({ kind: 'IMAGE', imageKey: null, text: 'Loja' })).toBeNull();
    expect(activeWatermarkSource({ kind: 'TEXT', imageKey: 'k', text: null })).toBeNull();
  });
});
