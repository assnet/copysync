import type {
  SaverExportFormat,
  SaverExtractionItemStatus,
  SaverExtractionStatus,
  SaverExtractionTrigger,
} from '../enums/SaverEnums';

/** Configuração do Saver por tenant (`saver_configs`). */
export interface SaverConfig {
  tenantId: string;
  namePrefix: string | null;
  excludeAdminsByDefault: boolean;
  defaultFormat: SaverExportFormat;
  autoRefresh: boolean;
  updatedAt: Date;
}

/** Grupo salvo pelo tenant. Único por `(tenantId, groupJid)`; `sessionId` = última sessão que leu. */
export interface SaverGroup {
  id: string;
  tenantId: string;
  sessionId: string | null;
  groupJid: string;
  name: string;
  memberCount: number;
  phoneCount: number;
  lidOnlyCount: number;
  lastScannedAt: Date | null;
  lastScanStatus: SaverExtractionItemStatus | null;
  createdAt: Date;
  /** Remoção lógica: some para o tenant e libera o limite; vínculos ficam. */
  removedAt: Date | null;
}

/**
 * Contato da base da PLATAFORMA (sem `tenantId`, de propósito). Só caminhos `Platform*` (super admin)
 * e a gravação da extração leem esta forma. `phone` = só dígitos com DDI; `lid` sem sufixo.
 */
export interface PlatformSaverContact {
  id: string;
  phone: string | null;
  lid: string | null;
  /** Melhor nome conhecido; nunca vai para arquivo de tenant (SAVER-46). */
  name: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Vínculo contato × grupo do tenant que extraiu. `name` = nome lido NESTE grupo (o que o tenant exporta). */
export interface SaverGroupMembership {
  id: string;
  tenantId: string;
  groupId: string;
  contactId: string;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: Date;
  lastExtractedAt: Date;
  lastExtractionId: string | null;
  leftAt: Date | null;
}

/** Liberação individual de exportar dada por um ADMIN a um OPERATOR do mesmo tenant (SAVER-43). */
export interface SaverExportGrant {
  id: string;
  tenantId: string;
  userId: string;
  grantedByUserId: string | null;
  createdAt: Date;
}

export interface SaverExtraction {
  id: string;
  tenantId: string;
  sessionId: string | null;
  requestedByUserId: string | null;
  trigger: SaverExtractionTrigger;
  status: SaverExtractionStatus;
  totalGroups: number;
  doneGroups: number;
  failedGroups: number;
  membersFound: number;
  newContacts: number;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface SaverExtractionItem {
  id: string;
  extractionId: string;
  tenantId: string;
  sessionId: string;
  groupId: string;
  status: SaverExtractionItemStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  errorCode: string | null;
  finishedAt: Date | null;
  /** Hora do pedido; base do teto de idade dos adiamentos. */
  createdAt: Date;
}

/** Ritmo do Saver por sessão, no banco (sem estado operacional só em memória). */
export interface SaverSessionState {
  sessionId: string;
  tenantId: string;
  nextScanAt: Date;
  pausedUntil: Date | null;
  pauseReason: string | null;
}
