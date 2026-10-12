/**
 * Converte uma mediaUrl relativa (ex.: /api/storage/media/file.jpg)
 * para a URL absoluta da API em produção.
 *
 * Em dev com proxy Vite, VITE_API_URL pode ser '/api', então apiRoot fica ''
 * e a URL permanece relativa — o proxy do Vite redireciona corretamente.
 *
 * Em produção, VITE_API_URL=https://api.copysync.app/api, então apiRoot
 * vira 'https://api.copysync.app' e a URL fica absoluta apontando para a API.
 */
const apiRaw: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

// Remove o sufixo /api para obter a raiz (https://api.copysync.app ou '')
const apiRoot = apiRaw === '/api' ? '' : apiRaw.replace(/\/api$/, '');

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // URLs absolutas ou blob: passam sem alteração
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  // Caminho relativo: prefixa com a raiz da API
  return `${apiRoot}${url}`;
}
