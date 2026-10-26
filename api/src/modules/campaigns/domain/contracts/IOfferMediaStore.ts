// Foto da oferta no media store. Só imagem.

export interface ConsumeOfferImageUploadInput {
  tenantId: string;
  userId: string;
  uploadId: string;
}

export interface IOfferMediaStore {
  /** Grava a foto baixada do marketplace; devolve a URL no store. */
  saveImage(buffer: Buffer, mimeType: string): Promise<string>;
  /** Consome upload do operador (chunkedUpload); não-imagem → UnsupportedMediaTypeError. */
  consumeUploadedImage(input: ConsumeOfferImageUploadInput): Promise<string>;
  /** Melhor esforço: apaga foto de oferta do store; URL que não é foto de oferta é ignorada. */
  removeImage(url: string): Promise<void>;
}
