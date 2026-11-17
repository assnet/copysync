import type {
  SaverConfig as PrismaSaverConfig,
  SaverContact as PrismaSaverContact,
  SaverExportGrant as PrismaSaverExportGrant,
  SaverExtraction as PrismaSaverExtraction,
  SaverExtractionItem as PrismaSaverExtractionItem,
  SaverGroup as PrismaSaverGroup,
} from '@prisma/client';
import type {
  PlatformSaverContact,
  SaverConfig,
  SaverExportGrant,
  SaverExtraction,
  SaverExtractionItem,
  SaverGroup,
} from '../../domain/entities/SaverEntities';
import {
  SaverExportFormat,
  SaverExtractionItemStatus,
  SaverExtractionStatus,
  SaverExtractionTrigger,
} from '../../domain/enums/SaverEnums';

/** Prisma ↔ domínio do Saver. Colunas de status são texto: valor fora do enum cai no padrão seguro. */
function oneOf<T extends string>(values: Record<string, T>, value: string | null, fallback: T): T {
  return value !== null && (Object.values(values) as string[]).includes(value) ? (value as T) : fallback;
}

export const PrismaSaverMapper = {
  config(row: PrismaSaverConfig): SaverConfig {
    return {
      tenantId: row.tenantId,
      namePrefix: row.namePrefix,
      excludeAdminsByDefault: row.excludeAdminsByDefault,
      defaultFormat: oneOf(SaverExportFormat, row.defaultFormat, SaverExportFormat.CSV),
      autoRefresh: row.autoRefresh,
      updatedAt: row.updatedAt,
    };
  },

  group(row: PrismaSaverGroup): SaverGroup {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      groupJid: row.groupJid,
      name: row.name,
      memberCount: row.memberCount,
      phoneCount: row.phoneCount,
      lidOnlyCount: row.lidOnlyCount,
      lastScannedAt: row.lastScannedAt,
      lastScanStatus:
        row.lastScanStatus === null ? null : oneOf(SaverExtractionItemStatus, row.lastScanStatus, SaverExtractionItemStatus.FAILED),
      createdAt: row.createdAt,
      removedAt: row.removedAt,
    };
  },

  contact(row: PrismaSaverContact): PlatformSaverContact {
    return {
      id: row.id,
      phone: row.phone,
      lid: row.lid,
      name: row.name,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    };
  },

  grant(row: PrismaSaverExportGrant): SaverExportGrant {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      grantedByUserId: row.grantedByUserId,
      createdAt: row.createdAt,
    };
  },

  extraction(row: PrismaSaverExtraction): SaverExtraction {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      requestedByUserId: row.requestedByUserId,
      trigger: oneOf(SaverExtractionTrigger, row.trigger, SaverExtractionTrigger.MANUAL),
      status: oneOf(SaverExtractionStatus, row.status, SaverExtractionStatus.FAILED),
      totalGroups: row.totalGroups,
      doneGroups: row.doneGroups,
      failedGroups: row.failedGroups,
      membersFound: row.membersFound,
      newContacts: row.newContacts,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    };
  },

  /** Também serve a linha crua do `RETURNING` do claim (mesmas colunas). */
  item(row: Pick<PrismaSaverExtractionItem, Exclude<keyof PrismaSaverExtractionItem, 'createdAt'>>): SaverExtractionItem {
    return {
      id: row.id,
      extractionId: row.extractionId,
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      groupId: row.groupId,
      status: oneOf(SaverExtractionItemStatus, row.status, SaverExtractionItemStatus.FAILED),
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      lockedUntil: row.lockedUntil,
      errorCode: row.errorCode,
      finishedAt: row.finishedAt,
    };
  },
};
