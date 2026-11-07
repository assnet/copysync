/** Limite do Chrome para `runtime.setUninstallURL`. */
export const UNINSTALL_URL_MAX_LENGTH = 1023;

/**
 * URL aberta pelo Chrome ao remover a extensão: `<panel>/extension-removed?i=&e=&v=`.
 * Pura (sem `chrome.*`). Devolve `null` se `panelUrl` vazio/inválido ou se passar de 1023 chars.
 */
export const buildUninstallUrl = (
  panelUrl: string,
  installationId: string,
  extensionId: string,
  version: string,
): string | null => {
  if (!panelUrl) return null;
  let url: URL;
  try {
    url = new URL('extension-removed', panelUrl.endsWith('/') ? panelUrl : `${panelUrl}/`);
  } catch {
    return null;
  }
  url.search = new URLSearchParams({ i: installationId, e: extensionId, v: version }).toString();
  const out = url.toString();
  return out.length > UNINSTALL_URL_MAX_LENGTH ? null : out;
};
