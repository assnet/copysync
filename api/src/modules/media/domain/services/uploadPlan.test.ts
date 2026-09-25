import { describe, it, expect } from 'vitest';
import { planUpload, expectedPartLength, validatePart } from './uploadPlan';

const KIB = 1024;
const MIB = 1024 * KIB;

describe('planUpload', () => {
  it('divide em partes cheias quando o tamanho é múltiplo exato do chunk', () => {
    expect(planUpload(3 * KIB, KIB)).toEqual({ totalParts: 3 });
  });

  it('usa uma parte só quando o arquivo é menor que um chunk', () => {
    expect(planUpload(500, KIB)).toEqual({ totalParts: 1 });
  });

  it('usa uma parte para arquivo de 1 byte', () => {
    expect(planUpload(1, KIB)).toEqual({ totalParts: 1 });
  });

  it('arredonda para cima: 180.000.000 bytes em chunks de 8 MiB viram 22 partes', () => {
    expect(planUpload(180_000_000, 8 * MIB)).toEqual({ totalParts: 22 });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'recusa tamanho de arquivo %s com erro de validação',
    (sizeBytes) => {
      expect(() => planUpload(sizeBytes, KIB)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }),
      );
    },
  );

  it.each([0, -KIB, 0.5, Number.NaN])('recusa tamanho de chunk %s com erro de validação', (chunk) => {
    expect(() => planUpload(KIB, chunk)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }),
    );
  });
});

describe('expectedPartLength', () => {
  it('espera chunk cheio em toda parte quando o tamanho é múltiplo exato', () => {
    expect(expectedPartLength(3 * KIB, KIB, 0)).toBe(KIB);
    expect(expectedPartLength(3 * KIB, KIB, 2)).toBe(KIB);
  });

  it('espera o arquivo inteiro na única parte de um arquivo menor que o chunk', () => {
    expect(expectedPartLength(500, KIB, 0)).toBe(500);
  });

  it('espera 1 byte na parte de um arquivo de 1 byte', () => {
    expect(expectedPartLength(1, KIB, 0)).toBe(1);
  });

  it('espera o resto na última parte de 180.000.000 bytes e a soma fecha o arquivo', () => {
    const size = 180_000_000;
    const chunk = 8 * MIB;
    const { totalParts } = planUpload(size, chunk);

    expect(expectedPartLength(size, chunk, 0)).toBe(chunk);
    expect(expectedPartLength(size, chunk, 20)).toBe(chunk);
    // 180.000.000 − 21 × 8.388.608 = 3.839.232
    expect(expectedPartLength(size, chunk, 21)).toBe(3_839_232);

    let soma = 0;
    for (let i = 0; i < totalParts; i++) soma += expectedPartLength(size, chunk, i);
    expect(soma).toBe(size);
  });

  it.each([-1, 0.5, 3])('recusa índice %s fora do plano com erro de validação', (index) => {
    expect(() => expectedPartLength(3 * KIB, KIB, index)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});

describe('validatePart', () => {
  const plano = { sizeBytes: 2 * KIB + 100, chunkSizeBytes: KIB }; // 3 partes: 1024, 1024, 100

  it('aceita parte do meio com chunk cheio', () => {
    expect(validatePart({ ...plano, index: 1, length: KIB })).toEqual({ ok: true });
  });

  it('aceita a última parte com o resto exato', () => {
    expect(validatePart({ ...plano, index: 2, length: 100 })).toEqual({ ok: true });
  });

  it('aceita a última parte cheia quando o tamanho é múltiplo exato', () => {
    expect(
      validatePart({ sizeBytes: 3 * KIB, chunkSizeBytes: KIB, index: 2, length: KIB }),
    ).toEqual({ ok: true });
  });

  it.each([
    ['negativo', -1],
    ['fracionário', 0.5],
    ['igual ao total de partes', 3],
    ['maior que o total de partes', 4],
    ['não numérico', Number.NaN],
  ])('recusa índice %s', (_caso, index) => {
    expect(validatePart({ ...plano, index, length: KIB })).toEqual({
      ok: false,
      reason: 'invalid_index',
    });
  });

  it('recusa parte do meio menor que o chunk', () => {
    expect(validatePart({ ...plano, index: 0, length: KIB - 1 })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
  });

  it('recusa parte do meio maior que o chunk', () => {
    expect(validatePart({ ...plano, index: 1, length: KIB + 1 })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
  });

  it('recusa a última parte enviada com chunk cheio em vez do resto', () => {
    // Cliente que preenche a última parte até o chunk corromperia o fim do arquivo.
    expect(validatePart({ ...plano, index: 2, length: KIB })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
  });

  it('recusa a última parte com 1 byte a menos que o resto', () => {
    expect(validatePart({ ...plano, index: 2, length: 99 })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
  });

  it('recusa parte vazia', () => {
    expect(validatePart({ ...plano, index: 0, length: 0 })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
  });

  it('recusa a última parte errada no upload de 180.000.000 bytes', () => {
    const grande = { sizeBytes: 180_000_000, chunkSizeBytes: 8 * MIB };
    expect(validatePart({ ...grande, index: 21, length: 3_839_232 })).toEqual({ ok: true });
    expect(validatePart({ ...grande, index: 21, length: 8 * MIB })).toEqual({
      ok: false,
      reason: 'invalid_length',
    });
    expect(validatePart({ ...grande, index: 22, length: 1 })).toEqual({
      ok: false,
      reason: 'invalid_index',
    });
  });

  it('propaga erro de validação quando o plano gravado é inválido', () => {
    expect(() => validatePart({ sizeBytes: 0, chunkSizeBytes: KIB, index: 0, length: 0 })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
