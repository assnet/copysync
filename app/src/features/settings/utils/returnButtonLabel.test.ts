import { describe, expect, it } from 'vitest';
import { returnButtonLabel } from './returnButtonLabel';
import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate;

describe('returnButtonLabel', () => {
  it('monitoramento (com query ou subrota) → "Voltar ao monitoramento"', () => {
    expect(returnButtonLabel('/monitoring')).toBe(t.backToMonitoring);
    expect(returnButtonLabel('/monitoring?sessionId=s1')).toBe(t.backToMonitoring);
    expect(returnButtonLabel('/monitoring/abc')).toBe(t.backToMonitoring);
  });

  it('outro destino → "Voltar"', () => {
    expect(returnButtonLabel('/storefront')).toBe(t.back);
    expect(returnButtonLabel('/monitoringx')).toBe(t.back);
    expect(returnButtonLabel('/campaigns?x=/monitoring')).toBe(t.back);
  });
});
