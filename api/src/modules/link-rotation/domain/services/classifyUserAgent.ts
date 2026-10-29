import type { UserAgentClass } from '../enums/LinkRotationEnums';

// HEURÍSTICA, não lista oficial: os apps mudam o UA sem aviso. Revisar quando o painel
// mostrar cliques "bot" ou "webview" fora do esperado.
//
// Ordem importa: bots de preview vêm antes das webviews. O UA "WhatsApp/2.x" é o robô
// que monta a prévia do link (não conta clique); `facebookexternalhit` idem, apesar de
// a webview do Facebook (FBAN/FBAV) ser pessoa real.

const KNOWN_BOTS =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot|Applebot|^curl\/|\bwget\/|python-requests/i;

const WEBVIEWS = /Instagram|FBAN|FBAV|FB_IAB|musical_ly|BytedanceWebview|TikTok|\bLine\//;

const GENERIC_BOT = /bot|crawler|spider/i;

export function classifyUserAgent(userAgent: string | null | undefined): UserAgentClass {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return 'bot';
  if (KNOWN_BOTS.test(ua)) return 'bot';
  if (WEBVIEWS.test(ua)) return 'webview';
  if (GENERIC_BOT.test(ua)) return 'bot';
  return 'browser';
}
