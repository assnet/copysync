/**
 * Atalhos públicos da plataforma usados fora do login (compra, suporte, vídeo de apresentação).
 * Compra e suporte passam pelos links de redirecionamento (`/redirect/<slug>`), para o super-admin
 * trocar o destino e acompanhar os cliques em Plataforma → Links de redirecionamento
 * (docs/redirect-links.md). O slug precisa existir e estar ativo lá; sem ele o visitante vê
 * "Link indisponível".
 */
import { REDIRECT_PUBLIC_PATH } from '@/features/redirectLinks/strings';

/** Página de vendas, clique vindo do login (slug `comprar-login`). */
export const BUY_NOW_PATH = `${REDIRECT_PUBLIC_PATH}/comprar-login`;

/** Suporte por WhatsApp (slug `suporte`). */
export const SUPPORT_CHAT_PATH = `${REDIRECT_PUBLIC_PATH}/suporte`;

/** Vídeo de apresentação do produto (YouTube, 16:9). */
export const INTRO_VIDEO_ID = 'NYYV03xBuak';
/** Player sem cookies até o clique; `frame-src` liberado no CSP do `render.yaml`. */
export const INTRO_VIDEO_EMBED_URL = `https://www.youtube-nocookie.com/embed/${INTRO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
export const INTRO_VIDEO_WATCH_URL = `https://youtu.be/${INTRO_VIDEO_ID}`;
/** Capa: tenta `maxresdefault` e cai em `hqdefault` (sempre existe). */
export const INTRO_VIDEO_POSTERS = [
  `https://i.ytimg.com/vi/${INTRO_VIDEO_ID}/maxresdefault.jpg`,
  `https://i.ytimg.com/vi/${INTRO_VIDEO_ID}/hqdefault.jpg`,
] as const;
