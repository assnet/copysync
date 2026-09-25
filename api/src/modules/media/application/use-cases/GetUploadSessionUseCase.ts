import type { IUploadSessionStore, UploadSessionState } from '../../domain/contracts/IUploadSessionStore';
import { UploadNotFoundError } from '../../../../shared/errors/internal/MediaErrors';

export interface GetUploadSessionInput {
  tenantId: string;
  userId: string;
  uploadId: string;
}

export interface GetUploadSessionOutput {
  /** Ordenado, sem repetição: o painel retoma enviando só o que falta. */
  receivedParts: number[];
  complete: boolean;
  state: UploadSessionState;
  /** Preenchido em `CONSUMED`: a mensagem que o upload virou. */
  messageId: string | null;
}

/**
 * Situação de um upload em partes (`GET /api/media/uploads/:uploadId`).
 * Inexistente, expirado ou de outro dono → `UPLOAD_NOT_FOUND`.
 */
export class GetUploadSessionUseCase {
  constructor(private readonly store: IUploadSessionStore) {}

  async execute(input: GetUploadSessionInput): Promise<GetUploadSessionOutput> {
    const record = await this.store.get(input.uploadId, input.tenantId, input.userId);
    if (!record) throw new UploadNotFoundError();

    const { receivedParts, totalParts, state, messageId } = record;
    return { receivedParts, complete: receivedParts.length === totalParts, state, messageId };
  }
}
