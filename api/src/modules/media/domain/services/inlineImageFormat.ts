/**
 * Formato da foto que sai como imagem no WhatsApp (não como documento nem figurinha).
 *
 * O app oficial converte toda foto para JPEG antes de enviar; WebP no protocolo é figurinha.
 * Foto `image/webp` aparece no iPhone, mas o app Android não exibe a mensagem (some inteira,
 * legenda junto). Por isso WebP vira JPEG antes do envio. PNG chega bem nos dois e segue.
 */
export const INLINE_IMAGE_TARGET_MIME = 'image/jpeg';

const NEEDS_TRANSCODE = new Set(['image/webp']);

/** `true` quando a foto precisa virar JPEG antes de ir como imagem. */
export function needsInlineImageTranscode(mimeType: string): boolean {
  return NEEDS_TRANSCODE.has(mimeType.toLowerCase());
}
