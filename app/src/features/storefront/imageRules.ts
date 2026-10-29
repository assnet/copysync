/**
 * Checagem leve da imagem no navegador, antes de subir: só tipo e tamanho (os mesmos da regra
 * exibida em `strings.fields.photo/cover.rule`). Dimensão, conteúdo real e recorte são do servidor
 * (`SharpStorefrontImageProcessor`), que continua dono da regra.
 */
import type { StorefrontImageKind } from './types';

const MB = 1024 * 1024;

export const STOREFRONT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const STOREFRONT_IMAGE_MAX_BYTES: Record<StorefrontImageKind, number> = {
  avatar: 2 * MB,
  cover: 4 * MB,
};

export type StorefrontImageProblem = 'UNSUPPORTED_MEDIA_TYPE' | 'MEDIA_TOO_LARGE';

/** null = pode subir. O código é o mesmo da API, para a tela usar um texto só. */
export function checkStorefrontImage(kind: StorefrontImageKind, file: Pick<File, 'type' | 'size'>): StorefrontImageProblem | null {
  if (!(STOREFRONT_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'UNSUPPORTED_MEDIA_TYPE';
  if (file.size > STOREFRONT_IMAGE_MAX_BYTES[kind]) return 'MEDIA_TOO_LARGE';
  return null;
}
