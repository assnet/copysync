import { isSupportedProductUrl } from './detectMarketplace';

/**
 * Link de compartilhamento devolvido pela API do marketplace (ex.: `shareLink` da Shein) só vale
 * se passar a mesma allowlist da URL colada. Texto que não é URL = inválido.
 */
export function isSupportedShareLink(raw: string): boolean {
  try {
    return isSupportedProductUrl(new URL(raw));
  } catch {
    return false;
  }
}
