/**
 * Conversão de foto para o formato aceito como imagem pelo WhatsApp (ver `inlineImageFormat`).
 * Caminhos absolutos gerados pela API; nunca caminho vindo do usuário.
 */
export interface IImageTranscoder {
  /**
   * Grava em `output` um JPEG da 1ª página de `input`, com orientação EXIF aplicada, fundo
   * branco no lugar da transparência e sem metadados.
   * @throws {MediaProcessingFailedError} arquivo ilegível ou grande demais.
   */
  toJpeg(input: string, output: string): Promise<void>;

  /**
   * JPEG em memória com lado maior ≤ `maxSide` (nunca amplia), mesmo tratamento do `toJpeg`.
   * `input`: caminho gerado pela API ou bytes já lidos.
   * @throws {MediaProcessingFailedError} arquivo ilegível ou grande demais.
   */
  resizeJpeg(input: string | Buffer, maxSide: number, quality: number): Promise<ResizedJpeg>;
}

export interface ResizedJpeg {
  buffer: Buffer;
  width: number;
  height: number;
}
