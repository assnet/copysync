import type { IUploadSessionStore } from '../../domain/contracts/IUploadSessionStore';

export interface CancelUploadSessionInput {
  tenantId: string;
  userId: string;
  uploadId: string;
}

/**
 * Cancela um upload em partes (`DELETE /api/media/uploads/:uploadId`). Idempotente: sempre
 * termina em sucesso, sem dizer se o upload existia.
 *
 * - Inexistente ou de outro dono → nada a fazer (não vaza existência).
 * - `OPEN` → `discardIfOpen`: apaga o parcial e o lateral. O estado é conferido de novo sob o
 *   mutex do store — uma confirmação que comece entre a leitura e o descarte vence.
 * - `CONSUMING` → nada: o consumo em curso decide o destino (vira mensagem ou é liberado);
 *   apagar o `.bin` agora quebraria a promoção no meio.
 * - `CONSUMED` → nada: a mensagem e o arquivo promovido já pertencem à conversa, e o
 *   lateral fica até o TTL porque é ele que faz a confirmação repetida devolver a mesma
 *   mensagem. O `discard` só mexe na pasta de uploads, mas mesmo assim quebraria essa
 *   idempotência — quem apaga é a varredura.
 */
export class CancelUploadSessionUseCase {
  constructor(private readonly store: IUploadSessionStore) {}

  async execute(input: CancelUploadSessionInput): Promise<void> {
    const record = await this.store.get(input.uploadId, input.tenantId, input.userId);
    if (record?.state !== 'OPEN') return;

    await this.store.discardIfOpen(input.uploadId);
  }
}
