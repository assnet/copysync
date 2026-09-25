/**
 * Arquivo definitivo da mídia enviada: a pasta servida pela rota estática.
 *
 * O upload montado fica fora da raiz estática; `promote` o leva para lá com o mesmo nome que o
 * download da mídia recebida usaria, então o eco do próprio envio acha o arquivo e não baixa
 * de novo.
 */
export interface PromoteMediaFileInput {
  /** Arquivo pronto (montado ou transcodificado) na pasta temporária. */
  srcPath: string;
  sessionId: string;
  /** Id da mensagem no WhatsApp: o mesmo que o eco trará. */
  externalMessageId: string;
  /** Tipo final, depois da classificação; define a extensão. */
  mimeType: string;
}

export interface PromotedMediaFile {
  /** URL relativa gravada em `mediaUrl`. */
  publicUrl: string;
  /** Caminho absoluto no disco. */
  localPath: string;
  sizeBytes: number;
}

export interface IMediaFileStore {
  /** Move o arquivo para a pasta de mídia (a origem deixa de existir); sobrescreve o destino. */
  promote(input: PromoteMediaFileInput): Promise<PromotedMediaFile>;
  /** Caminho no disco de uma `mediaUrl` desta pasta; `null` se não for daqui ou tentar sair dela. */
  resolveLocalPath(mediaUrl: string): string | null;
  /** Apaga o arquivo; ausente não é erro. */
  remove(localPath: string): Promise<void>;
  exists(localPath: string): Promise<boolean>;
}
