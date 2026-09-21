import type { ConversationStatus } from './types';

// ── Status config ─────────────────────────────────────────────────────────────

export function getStatusConfig(status: ConversationStatus): { label: string; color: string } {
  switch (status) {
    case 'open':    return { label: 'Aberta',   color: '#22c55e' };
    case 'pending': return { label: 'Pendente', color: '#f59e0b' };
    case 'waiting': return { label: 'Fila',     color: '#f59e0b' };
    case 'bot':     return { label: 'Bot',      color: '#3b82f6' };
    case 'closed':  return { label: 'Enc.',     color: '#9096a8' };
  }
}

// ── Formatação de tempo ───────────────────────────────────────────────────────

/** Formata timestamp para exibição na lista de conversas */
export function formatConversationTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (wasYesterday) return 'Ontem';

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Formata timestamp para exibição dentro da bolha de mensagem */
export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Formata separador de data entre grupos de mensagens */
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) return 'Hoje';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (wasYesterday) return 'Ontem';

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  '#4f70e0', '#7c3aed', '#0ea5e9',
  '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899',
];

/** Gera uma cor de avatar determinística a partir do nome */
export function getAvatarColor(name: string): string {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) ?? 0);
  return AVATAR_PALETTE[code % AVATAR_PALETTE.length];
}

// ── Telefone ──────────────────────────────────────────────────────────────────

/** Formata número de telefone para exibição */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13) {
    // 5511988881234 → +55 11 9 8888-1234
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 5)} ${digits.slice(5, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    // 554499881234 → +55 44 9988-1234
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return phone;
}

// ── Prévia de tipo de mensagem ────────────────────────────────────────────────

/**
 * Formata o preview da última mensagem para exibição na lista de conversas.
 * Para mensagens de mídia, retorna ícone + rótulo quando não há legenda.
 */
export function formatLastMessagePreview(
  type: string | null | undefined,
  content: string | null | undefined,
): string {
  const t = (type ?? 'text').toUpperCase();
  switch (t) {
    case 'IMAGE':    return content ? `📷 ${content}` : '📷 Foto';
    case 'AUDIO':    return '🎵 Áudio';
    case 'VIDEO':    return content ? `🎥 ${content}` : '🎥 Vídeo';
    case 'DOCUMENT': return content ? `📄 ${content}` : '📄 Documento';
    case 'STICKER':  return '🏷️ Figurinha';
    case 'LOCATION': return '📍 Localização';
    case 'VCARD':    return '👤 Contato';
    case 'CALL_LOG': return '📞 Chamada';
    default:         return content ?? '';
  }
}

// ── Não lidas ─────────────────────────────────────────────────────────────────

/**
 * Conversa conta como não lida por mensagens pendentes ou por marcação manual —
 * do operador no painel, ou do usuário em outro aparelho.
 *
 * A marcação manual não tem número: zera o contador e ainda assim a conversa fica
 * destacada, como no WhatsApp.
 */
export function isUnread(conversation: { unreadCount: number; manuallyUnread?: boolean }): boolean {
  return conversation.unreadCount > 0 || (conversation.manuallyUnread ?? false);
}

/** Total exibido no cabeçalho: conversa marcada manualmente vale 1. */
export function countUnread(conversations: Array<{ unreadCount: number; manuallyUnread?: boolean }>): number {
  return conversations.reduce(
    (sum, c) => sum + (c.unreadCount > 0 ? c.unreadCount : (c.manuallyUnread ? 1 : 0)),
    0,
  );
}

// ── Ordenação da lista de conversas ───────────────────────────────────────────

/**
 * Ordem da lista: fixadas primeiro, depois a mais recente.
 *
 * É a mesma regra que o servidor aplica ao listar (`orderBy: pinned, lastMessageAt`),
 * repetida aqui para reordenar sem ida ao servidor quando a fixação muda — pelo painel
 * ou em outro aparelho do usuário.
 */
export function byPinnedThenRecent(
  a: { pinned?: boolean; lastMessageAt?: string | null },
  b: { pinned?: boolean; lastMessageAt?: string | null },
): number {
  if ((a.pinned ?? false) !== (b.pinned ?? false)) return a.pinned ? -1 : 1;
  return new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();
}
