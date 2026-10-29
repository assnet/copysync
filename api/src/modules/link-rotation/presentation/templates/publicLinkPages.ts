import { allowedMediaUrl, escapeHtml, renderPublicPage } from './publicLinkLayout';

/** Textos da página pública (pt-BR). Chaves semânticas; nenhum nome de produto aqui. */
export const PUBLIC_LINK_TEXT = {
  join: 'Entrar no grupo',
  joining: 'Você vai entrar no grupo',
  groupKind: 'Grupo do WhatsApp',
  ready: 'Seu convite está pronto.',
  hint: 'Se nada acontecer, toque no botão.',
  preview: 'Toque no link para entrar no grupo.',
  fullHeading: 'Grupos lotados',
  full: 'Todos os grupos estão cheios agora. Novas vagas abrem em breve, volte daqui a pouco.',
  pausedHeading: 'Link em pausa',
  paused: 'Este link está pausado no momento. Tente de novo mais tarde.',
  unavailableHeading: 'Link indisponível',
  unavailable: 'Não conseguimos abrir este link agora. Tente de novo em alguns minutos.',
  notFoundHeading: 'Link não encontrado',
  notFound: 'Confira o endereço e tente de novo.',
  tooManyHeading: 'Muitos acessos',
  tooMany: 'Recebemos muitos acessos da sua rede agora. Espere um minuto e tente de novo.',
} as const;

const T = PUBLIC_LINK_TEXT;
const p = (html: string) => `<p>${html}</p>`;

/** Grupo numa linha, foto à esquerda (ou inicial do nome), como na lista do WhatsApp. */
function groupRow(name: string, avatarUrl: string | null): string {
  const initial = escapeHtml((Array.from(name.trim())[0] ?? '#').toUpperCase());
  const avatar = avatarUrl
    ? `<img class="av" src="${escapeHtml(avatarUrl)}" width="52" height="52" alt="" referrerpolicy="no-referrer">`
    : `<span class="av av-i" aria-hidden="true">${initial}</span>`;
  const label = escapeHtml(name);
  return `<div class="grp">${avatar}<span class="gi"><span class="gn" title="${label}">${label}</span><span class="gs">${T.groupKind}</span></span></div>`;
}

export function redirectPage(input: {
  title: string;
  groupName: string | null;
  groupAvatarUrl?: string | null;
  inviteUrl: string;
}): string {
  const avatar = allowedMediaUrl(input.groupAvatarUrl);
  return renderPublicPage({
    title: input.title,
    heading: input.title,
    description: T.preview,
    image: avatar,
    bodyHtml: input.groupName ? p(T.joining) + groupRow(input.groupName, avatar) : p(T.ready),
    action: { href: input.inviteUrl, label: T.join },
    refreshUrl: input.inviteUrl,
    hint: T.hint,
  });
}

/** Prévia para robôs (WhatsApp, Facebook…): só OG, sem convite. */
export function botPreviewPage(title: string): string {
  return renderPublicPage({ title, heading: title, description: T.preview, bodyHtml: p(T.preview) });
}

export function allFullPage(title: string): string {
  return renderPublicPage({ title, heading: T.fullHeading, description: T.full, bodyHtml: p(T.full) });
}

export function pausedPage(title: string): string {
  return renderPublicPage({ title, heading: T.pausedHeading, description: T.paused, bodyHtml: p(T.paused) });
}

export function unavailablePage(): string {
  return renderPublicPage({ title: T.unavailableHeading, heading: T.unavailableHeading, bodyHtml: p(T.unavailable) });
}

export function notFoundPage(): string {
  return renderPublicPage({ title: T.notFoundHeading, heading: T.notFoundHeading, bodyHtml: p(T.notFound) });
}

/** 429 do rate limit em host público: página da marca em vez do JSON da API. */
export function tooManyRequestsPage(): string {
  return renderPublicPage({ title: T.tooManyHeading, heading: T.tooManyHeading, bodyHtml: p(T.tooMany) });
}
