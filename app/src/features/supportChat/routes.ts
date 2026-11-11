/**
 * Onde o botão flutuante de suporte NÃO aparece ou sobe. Regra pura (testada): casa o prefixo
 * exato ou seguido de `/` — `/chat` não esconde `/chatbots`.
 */
import { REDIRECT_PUBLIC_PATH } from '@/features/redirectLinks/strings';

/**
 * Rotas sem o botão:
 * - `/redirect/*`: página de transição (o próprio destino do botão); some em seguida.
 * - `/chat`: o composer (enviar/gravar) e o "ir para o fim" ocupam o canto inferior direito.
 * - `/admin/workers/settings`: "Revisar e salvar" fica no fim do formulário (não é sticky), então
 *   subir o botão só passaria a cobrir campo e slider; tela só de super admin, sem uso de suporte.
 */
export const SUPPORT_CHAT_HIDDEN_PATHS: readonly string[] = [REDIRECT_PUBLIC_PATH, '/chat', '/admin/workers/settings'];

/**
 * Rotas com barra de ação presa ao rodapé: o botão sobe para não cobrir "Salvar".
 * - `/monitoring`: barra "alterações não salvas" (`MonitoringSettingsForm`, sticky a 16 px do
 *   rodapé; quebra em duas linhas no celular).
 * - `/offer-story`: "Continuar" fica preso ao rodapé no celular (`TemplateStep`, sticky).
 */
export const SUPPORT_CHAT_RAISED_PATHS: readonly string[] = ['/monitoring', '/offer-story'];

const matches = (pathname: string, prefixes: readonly string[]) => {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
};

export const isSupportChatHidden = (pathname: string) => matches(pathname, SUPPORT_CHAT_HIDDEN_PATHS);
export const isSupportChatRaised = (pathname: string) => matches(pathname, SUPPORT_CHAT_RAISED_PATHS);
