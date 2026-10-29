import type { LinkRotationGroupLinkSource, LinkRotationGroupStatus } from '../enums/LinkRotationEnums';

/** Grupo participante de uma rotação. */
export interface LinkRotationGroup {
  id: string;
  tenantId: string;
  rotationId: string;
  /** ChatConversation (isGroup). */
  conversationId: string;
  /** JID sem `@g.us`. */
  groupJid: string;
  /** Ordem (SEQUENTIAL). */
  position: number;
  /** 1–100 (WEIGHTED). */
  weight: number;
  /** Teto de membros, 50–1024. */
  capacity: number;
  /** Só o code; link = https://chat.whatsapp.com/<code>. */
  inviteCode: string | null;
  linkSource: LinkRotationGroupLinkSource | null;
  status: LinkRotationGroupStatus;
  /** Última leitura via sessão. */
  memberCount: number | null;
  memberCountAt: Date | null;
  /** Cliques desde a última leitura de membros (entra na estimativa de lotação). */
  clicksSinceSync: number;
  clickCount: number;
  lastClickAt: Date | null;
}
