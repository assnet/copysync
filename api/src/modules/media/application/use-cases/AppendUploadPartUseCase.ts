import type { IUploadSessionStore } from '../../domain/contracts/IUploadSessionStore';
import { validatePart } from '../../domain/services/uploadPlan';
import { UploadNotFoundError } from '../../../../shared/errors/internal/MediaErrors';
import { ConflictError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

export interface AppendUploadPartInput {
  tenantId: string;
  userId: string;
  uploadId: string;
  index: number;
  data: Uint8Array;
}

export interface AppendUploadPartOutput {
  receivedParts: number[];
  complete: boolean;
}

/**
 * Recebe uma parte de um upload em partes (`PUT /api/media/uploads/:uploadId/parts/:index`).
 *
 * Ordem: dono → plano → estado → escrita. Upload de outro dono responde como inexistente
 * (não vaza existência). O estado lido no `get` é só um retrato: o store confere de novo sob
 * o mutex do upload, então `not_open`/`not_found` na escrita cobrem consumo ou descarte
 * iniciados entre as duas chamadas.
 */
export class AppendUploadPartUseCase {
  constructor(private readonly store: IUploadSessionStore) {}

  async execute(input: AppendUploadPartInput): Promise<AppendUploadPartOutput> {
    const { tenantId, userId, uploadId, index, data } = input;

    const record = await this.store.get(uploadId, tenantId, userId);
    if (!record) throw new UploadNotFoundError();

    const check = validatePart({
      sizeBytes: record.sizeBytes,
      chunkSizeBytes: record.chunkSizeBytes,
      index,
      length: data.byteLength,
    });
    if (!check.ok) {
      throw new ValidationError('Upload part does not match the plan', { index, reason: check.reason });
    }

    if (record.state !== 'OPEN') throw notAcceptingParts();

    const result = await this.store.writePart(uploadId, index, data);
    if (result.status === 'not_found') throw new UploadNotFoundError();
    if (result.status === 'not_open') throw notAcceptingParts();

    const { receivedParts, totalParts } = result.record;
    return { receivedParts, complete: receivedParts.length === totalParts };
  }
}

function notAcceptingParts(): ConflictError {
  return new ConflictError('Upload is no longer accepting parts');
}
