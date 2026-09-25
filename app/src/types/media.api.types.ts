// ── Upload de mídia em partes (rotas `/media/uploads` e envio de mídia no chat) ──
// Espelha o contrato HTTP da API. O envio (`POST /chat/conversations/:id/messages/media`)
// e o reenvio (`POST /chat/messages/:messageId/retry`) respondem `ChatMessageApiDto`.

/** Finalidade declarada na criação do upload: define o limite de tamanho e o tratamento. */
export type MediaUploadPurpose = 'media' | 'document' | 'voice';

/** `GET /media/uploads/config` — limites para avisar antes de subir e o que o servidor suporta. */
export interface MediaUploadConfigDto {
  chunkSizeBytes: number;
  maxFilesPerBatch: number;
  maxVoiceSeconds: number;
  maxCaptionLength: number;
  limits: {
    imageBytes: number;
    inlineVideoBytes: number;
    documentBytes: number;
    voiceBytes: number;
  };
  capabilities: {
    /** `false` = servidor sem conversor de áudio: gravador de voz desabilitado. */
    voiceNotes: boolean;
    /** `false` = sem leitura de metadados de vídeo. */
    videoMetadata: boolean;
  };
}

/** `POST /media/uploads` — corpo. */
export interface CreateUploadRequest {
  fileName: string;
  sizeBytes: number;
  purpose: MediaUploadPurpose;
  declaredMimeType?: string;
}

/** `POST /media/uploads` — resposta 201. */
export interface UploadSessionDto {
  uploadId: string;
  chunkSizeBytes: number;
  totalParts: number;
  /** Índices das partes já recebidas (vazio na criação). */
  receivedParts: number[];
  /** ISO 8601. */
  expiresAt: string;
}

/** `PUT /media/uploads/:uploadId/parts/:index` — resposta 200. */
export interface UploadPartResultDto {
  receivedParts: number[];
  /** `true` quando todas as partes chegaram. */
  complete: boolean;
}

/** `GET /media/uploads/:uploadId` — usado para retomar o upload após falha. */
export interface UploadStatusDto {
  receivedParts: number[];
  complete: boolean;
  /** `CONSUMING` = envio em andamento; `CONSUMED` = já virou mensagem (`messageId`). */
  state: 'OPEN' | 'CONSUMING' | 'CONSUMED';
  messageId: string | null;
}

/** `POST /chat/conversations/:id/messages/media` — corpo (resposta 202, ou 200 se repetido). */
export interface SendMediaMessageRequest {
  uploadId: string;
  caption?: string;
  quotedMessageId?: string;
}
