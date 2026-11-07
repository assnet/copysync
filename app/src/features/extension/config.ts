import { readProxyIds } from './channel/proxyTransport';

/**
 * Configuração da extensão do navegador no painel. Único lugar com a URL da loja:
 * telas e testes importam daqui, nunca repetem o endereço.
 */
const DEFAULT_STORE_URL = 'https://chromewebstore.google.com/detail/copysync/nokcbnoicaebghagbhlfcbepheohdgnd';

/** Página da extensão na Chrome Web Store (`VITE_EXTENSION_STORE_URL` sobrepõe o padrão). */
export const EXTENSION_STORE_URL: string = import.meta.env.VITE_EXTENSION_STORE_URL?.trim() || DEFAULT_STORE_URL;

/** Rota pública aberta pela extensão ao ser desinstalada (`setUninstallURL`). */
export const EXTENSION_REMOVED_PATH = '/extension-removed';

/** Onde o usuário clicou em "Instalar": vai para `POST /extension/store-click`. */
export type ExtensionInstallSource = 'settings' | 'ml_wizard' | 'onboarding';

/** Abre a loja em nova aba sem dar acesso a esta janela (`noopener`). */
export function openExtensionStore(): void {
  window.open(EXTENSION_STORE_URL, '_blank', 'noopener');
}

interface UserAgentDataLike {
  brands?: Array<{ brand: string }>;
  mobile?: boolean;
}

/**
 * Navegador de computador baseado em Chromium (Chrome, Edge, Brave, Opera): os que instalam
 * da Chrome Web Store. Celular e Firefox/Safari ficam de fora.
 *
 * Não dá para usar `chrome.runtime` para isso: o Chrome só o expõe à página quando alguma
 * extensão instalada a declara em `externally_connectable` — sem a extensão, ele não existe.
 */
export function isChromiumDesktop(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const uaData = (nav as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  if (uaData?.brands?.length) {
    if (uaData.mobile) return false;
    return uaData.brands.some((b) => /Chromium|Google Chrome/i.test(b.brand));
  }
  const ua = nav.userAgent ?? '';
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return false;
  return /Chrome\/|Chromium\//.test(ua) && !/Firefox\//.test(ua);
}

/**
 * Navegador onde a extensão roda: Chromium de computador ou qualquer um em que o proxy da
 * extensão já marcou a página (Orion, que se identifica como Safari mas instala da Chrome Web Store).
 */
export function isExtensionCapableBrowser(nav?: Navigator): boolean {
  return isChromiumDesktop(nav) || readProxyIds().length > 0;
}
