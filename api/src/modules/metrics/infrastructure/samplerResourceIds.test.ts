import { describe, expect, it } from 'vitest';
import { parseResourceIds, samplerResourceIds } from './samplerResourceIds';

describe('samplerResourceIds', () => {
  it('lista da env sem o worker: igual à lista', () => {
    expect(samplerResourceIds(' srv-api , dpg-db ', undefined)).toEqual(['srv-api', 'dpg-db']);
    expect(parseResourceIds(undefined)).toEqual([]);
  });

  it('inclui o serviço worker válido ao fim', () => {
    expect(samplerResourceIds('srv-api,dpg-db', 'srv-wk')).toEqual(['srv-api', 'dpg-db', 'srv-wk']);
    expect(samplerResourceIds(undefined, ' srv-wk ')).toEqual(['srv-wk']);
  });

  it('não duplica quando o worker já está na lista', () => {
    expect(samplerResourceIds('srv-wk,srv-api', 'srv-wk')).toEqual(['srv-wk', 'srv-api']);
  });

  it('id do worker inválido é ignorado', () => {
    expect(samplerResourceIds('srv-api', 'dpg-x')).toEqual(['srv-api']);
    expect(samplerResourceIds('srv-api', 'srv-WK')).toEqual(['srv-api']);
  });
});
