import { apiClient } from './apiClient';
import type {
  CreateUploadRequest,
  MediaUploadConfigDto,
  UploadPartResultDto,
  UploadSessionDto,
  UploadStatusDto,
} from '@/types/media.api.types';

export interface PutPartOptions {
  signal?: AbortSignal;
  /** Bytes desta parte já enviados. */
  onProgress?: (sentBytes: number) => void;
}

export const mediaService = {
  async getUploadConfig(): Promise<MediaUploadConfigDto> {
    const res = await apiClient.get<{ success: true; data: MediaUploadConfigDto }>(
      '/media/uploads/config',
    );
    return res.data.data;
  },

  async createUpload(req: CreateUploadRequest): Promise<UploadSessionDto> {
    const res = await apiClient.post<{ success: true; data: UploadSessionDto }>(
      '/media/uploads',
      req,
    );
    return res.data.data;
  },

  /**
   * Envia o `Blob` cru; cabeçalho e cancelamento valem só para esta chamada. Sem tempo total: a
   * parte parada é abortada por inatividade pelo `signal` de quem chama (`chunkedUpload`).
   */
  async putPart(
    uploadId: string,
    index: number,
    blob: Blob,
    { signal, onProgress }: PutPartOptions = {},
  ): Promise<UploadPartResultDto> {
    const res = await apiClient.put<{ success: true; data: UploadPartResultDto }>(
      `/media/uploads/${uploadId}/parts/${index}`,
      blob,
      {
        // A instância fixa JSON; sem isto o Blob sairia como `application/json`.
        headers: { 'Content-Type': 'application/octet-stream' },
        signal,
        onUploadProgress: onProgress ? (e) => onProgress(e.loaded) : undefined,
      },
    );
    return res.data.data;
  },

  /** Retomada após falha: quais partes o servidor já tem e se virou mensagem. */
  async getUpload(uploadId: string): Promise<UploadStatusDto> {
    const res = await apiClient.get<{ success: true; data: UploadStatusDto }>(
      `/media/uploads/${uploadId}`,
    );
    return res.data.data;
  },

  /** Idempotente (204). */
  async cancelUpload(uploadId: string): Promise<void> {
    await apiClient.delete(`/media/uploads/${uploadId}`);
  },
};
