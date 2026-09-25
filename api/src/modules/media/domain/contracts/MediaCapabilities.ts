/**
 * O que o processador de mídia consegue fazer neste processo — detectado no boot.
 *
 * Sem ffmpeg/ffprobe a API continua de pé: a capacidade só desliga, e o painel lê isso
 * no config de upload para esconder o gravador ou avisar que o vídeo vai como documento.
 */
export interface MediaCapabilities {
  /** Há ffmpeg com libopus: nota de voz pode ser transcodificada para Ogg/Opus. */
  transcodeVoice: boolean;
  /** Há ffprobe: duração, dimensões e codec do vídeo são conhecidos. */
  probe: boolean;
}
