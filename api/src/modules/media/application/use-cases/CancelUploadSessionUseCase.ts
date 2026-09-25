import type { IUploadSessionStore } from '../../domain/contracts/IUploadSessionStore';
import { UploadInProgressError } from '../../../../shared/errors/internal/MediaErrors';

export interface CancelUploadSessionInput {
  tenantId: string;
  userId: string;
  uploadId: string;
}

/**
 * Cancela um upload em partes (`DELETE /api/media/uploads/:uploadId`). Idempotente: termina em
 * sucesso sem dizer se o upload existia — salvo durante o consumo, que responde 409.
 *
 * - Inexistente ou de outro dono → nada a fazer (não vaza existência).
 * - `OPEN` → `discardIfOpen`: apaga o parcial e o lateral.
 * - `CONSUMING` → `requestCancel` + `UploadInProgressError` (409): o consumo em curso decide o
 *   destino — liberado, o store descarta em vez de reabrir; concluído, a mensagem sai. Apagar o
 *   `.bin` agora quebraria a promoção no meio. O 409 avisa o painel que a mídia talvez já tenha saído.
 * - `CONSUMED` → nada: a mensagem e o arquivo promovido já pertencem à conversa, e o
 *   lateral fica até o TTL porque é ele que faz a confirmação repetida devolver a mesma
 *   mensagem. O `discard` só mexe na pasta de uploads, mas mesmo assim quebraria essa
 *   idempotência — quem apaga é a varredura.
 *
 * O estado lido no `get` só serve para dono e `CONSUMED`: cada passo seguinte reconfere sob o
 * mutex do store, porque a confirmação pode começar, falhar ou terminar entre uma chamada e outra.
 */
export class CancelUploadSessionUseCase {
  constructor(private readonly store: IUploadSessionStore) {}

  async execute(input: CancelUploadSessionInput): Promise<void> {
    const { uploadId } = input;
    const record = await this.store.get(uploadId, input.tenantId, input.userId);
    if (!record || record.state === 'CONSUMED') return;

    if (await this.store.discardIfOpen(uploadId)) return;
    if (await this.store.requestCancel(uploadId)) throw new UploadInProgressError(undefined, { uploadId });
    // Nem aberto nem em consumo: o consumo terminou (nada a fazer) ou falhou e reabriu o upload
    await this.store.discardIfOpen(uploadId);
  }
}
