import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

/** Resultado da validação de uma parte recebida. */
export type PartValidation =
  | { ok: true }
  | { ok: false; reason: 'invalid_index' | 'invalid_length' };

export interface PartToValidate {
  sizeBytes: number;
  chunkSizeBytes: number;
  index: number;
  length: number;
}

/**
 * Calcula quantas partes um upload tem: `ceil(tamanho / chunk)`.
 *
 * Tamanho e chunk precisam ser inteiros positivos — um plano com fração ou zero gera
 * posições de escrita erradas no `.bin` e o arquivo sai corrompido sem erro visível.
 */
export function planUpload(sizeBytes: number, chunkSizeBytes: number): { totalParts: number } {
  if (!isPositiveInteger(sizeBytes)) {
    throw new ValidationError('Upload size must be a positive integer', { sizeBytes });
  }
  if (!isPositiveInteger(chunkSizeBytes)) {
    throw new ValidationError('Upload chunk size must be a positive integer', { chunkSizeBytes });
  }
  return { totalParts: Math.ceil(sizeBytes / chunkSizeBytes) };
}

/**
 * Tamanho exato que a parte `index` deve ter: chunk cheio, exceto a última, que leva o resto.
 * Índice fora do plano é erro de validação.
 */
export function expectedPartLength(sizeBytes: number, chunkSizeBytes: number, index: number): number {
  const { totalParts } = planUpload(sizeBytes, chunkSizeBytes);
  if (!isValidIndex(index, totalParts)) {
    throw new ValidationError('Upload part index out of range', { index, totalParts });
  }
  return Math.min(chunkSizeBytes, sizeBytes - index * chunkSizeBytes);
}

/**
 * Confere índice e tamanho de uma parte contra o plano gravado.
 *
 * Tamanho diferente do esperado é recusado — inclusive a última parte enviada com chunk
 * cheio: escrita posicional passaria do fim do arquivo. Plano gravado inválido lança erro
 * (é defeito de quem criou o upload, não da parte).
 */
export function validatePart(input: PartToValidate): PartValidation {
  const { totalParts } = planUpload(input.sizeBytes, input.chunkSizeBytes);
  if (!isValidIndex(input.index, totalParts)) return { ok: false, reason: 'invalid_index' };

  const expected = expectedPartLength(input.sizeBytes, input.chunkSizeBytes, input.index);
  if (input.length !== expected) return { ok: false, reason: 'invalid_length' };

  return { ok: true };
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidIndex(index: number, totalParts: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < totalParts;
}
