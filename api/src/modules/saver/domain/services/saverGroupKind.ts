/** Tipo do grupo na listagem da sessão (WhatsApp). */
export type SaverGroupKind = 'GROUP' | 'COMMUNITY' | 'COMMUNITY_ANNOUNCE';

/** Por que o grupo não pode ser lido; null = pode. */
export type SaverGroupUnselectableReason = 'COMMUNITY_PARENT';

/**
 * Comunidade "pai" não tem conversa nem membros próprios: o WhatsApp devolve só a administração
 * dela. Quem reúne todos os membros é o grupo de avisos (COMMUNITY_ANNOUNCE), que segue liberado.
 */
export function saverGroupUnselectableReason(kind: SaverGroupKind | undefined): SaverGroupUnselectableReason | null {
  return kind === 'COMMUNITY' ? 'COMMUNITY_PARENT' : null;
}
