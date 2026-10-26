// Tipos de imagem aceitos na oferta: os mesmos que o envio de mídia armazenada aceita.

export const OFFER_IMAGE_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

const EXT_MIME: Readonly<Record<string, string>> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
};

/** Limite da foto da oferta (baixada ou enviada pelo operador). */
export const OFFER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Mime pela extensão da URL do store (`saveBuffer` grava `offer-<uuid>.<ext>`); padrão JPEG. */
export function offerImageMimeFromUrl(url: string): string {
  const pathPart = url.split(/[?#]/)[0] ?? '';
  const ext = /\.([a-z0-9]+)$/i.exec(pathPart)?.[1]?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'image/jpeg';
}
