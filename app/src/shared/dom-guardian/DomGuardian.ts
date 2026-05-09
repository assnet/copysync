/**
 * DomGuardian — blindagem contra injeção de estilos e elementos por extensões de terceiros.
 *
 * Extensões como "Video Speed Controller", "Stylus", "Dark Reader", etc. injetam
 * <style> e <link rel="stylesheet"> diretamente no <head>, podendo sobrescrever o
 * tema visual da aplicação. Algumas também injetam elementos no <body>.
 *
 * Este módulo usa MutationObserver para detectar e remover essas injeções, preservando
 * apenas estilos reconhecidos da própria aplicação (emotion/MUI, Vite HMR, etc.).
 */

/**
 * Atributos em <style> que identificam injeções legítimas da aplicação.
 * - data-emotion: emotion (MUI v5)
 * - data-styled: styled-components
 * - data-vite-dev-id: Vite HMR em dev
 * - data-app: marcador explícito do WaioPrime (aplicado em nossos estilos globais)
 */
const LEGITIMATE_STYLE_ATTRS = [
  'data-emotion',
  'data-styled',
  'data-vite-dev-id',
  'data-app',
];

/** Origens de extensões de browser — qualquer <link> desses schemes é injeção externa. */
const EXTENSION_HREF_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'ms-browser-extension://',
];

function isLegitimateStyle(el: HTMLStyleElement): boolean {
  return LEGITIMATE_STYLE_ATTRS.some((attr) => el.hasAttribute(attr));
}

function isExtensionLink(el: HTMLLinkElement): boolean {
  const href = el.href ?? '';
  return EXTENSION_HREF_PREFIXES.some((prefix) => href.startsWith(prefix));
}

function shouldBlock(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return false;

  const tag = node.tagName.toLowerCase();

  if (tag === 'style') {
    return !isLegitimateStyle(node as HTMLStyleElement);
  }

  if (tag === 'link') {
    const rel = (node as HTMLLinkElement).rel?.toLowerCase() ?? '';
    if (rel === 'stylesheet' && isExtensionLink(node as HTMLLinkElement)) {
      return true;
    }
  }

  return false;
}

export type DomGuardianConfig = {
  /** Emite log quando um elemento injetado é bloqueado (útil para debug). */
  debug?: boolean;
};

export class DomGuardian {
  private headObserver: MutationObserver | null = null;
  private debug: boolean;

  constructor(config: DomGuardianConfig = {}) {
    this.debug = config.debug ?? false;
  }

  start(): void {
    if (this.headObserver) return; // já iniciado

    this.headObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (shouldBlock(node)) {
            if (this.debug) {
              const tag = (node as HTMLElement).tagName.toLowerCase();
              const info =
                tag === 'link'
                  ? (node as HTMLLinkElement).href
                  : (node as HTMLStyleElement).textContent?.slice(0, 80);
              console.warn(`[DomGuardian] Injeção externa bloqueada: <${tag}> —`, info);
            }
            (node as Element).remove();
          }
        }
      }
    });

    this.headObserver.observe(document.head, { childList: true });
  }

  stop(): void {
    this.headObserver?.disconnect();
    this.headObserver = null;
  }
}

/** Instância singleton pronta para uso via hook. */
export const domGuardian = new DomGuardian({ debug: import.meta.env.DEV });
