import type { SaverOverviewDTO } from '../../application/use-cases/GetSaverOverviewUseCase';
import type { SaverSessionGroupDTO } from '../../application/use-cases/ListSaverSessionGroupsUseCase';
import type { SaverExtractionDTO } from '../../application/use-cases/saverExtractionDTO';
import type { CancelSaverExtractionOutput } from '../../application/use-cases/CancelSaverExtractionUseCase';
import type { SaverGroupDTO } from '../../application/use-cases/ListSaverGroupsUseCase';
import type { SaverConfigDTO, SaverExportGrantDTO } from '../../application/use-cases/SaverConfigUseCases';
import type { ListPlatformSaverContactsOutput, ListPlatformSaverTenantsOutput } from '../../application/use-cases/PlatformSaverContactsUseCases';
import type { PlatformSaverContactLink, PlatformSaverContactRow } from '../../domain/contracts/IPlatformSaverContactRepository';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Saída HTTP do Saver: datas em ISO e campos escolhidos um a um (nunca espalha DTO). Tenant: só contagens,
 * nunca nome, telefone ou LID de contato (teste em `saver.routes.test.ts`). `platform*` é só da rota de super admin.
 */
export const SaverPresenter = {
  overview(o: SaverOverviewDTO) {
    return {
      groups: o.groups,
      contacts: o.contacts,
      groupScansPerDay: o.groupScansPerDay,
      autoRefreshEnabled: o.autoRefreshEnabled,
      permissions: o.permissions,
      config: o.config,
      queueRunning: o.queueRunning,
      pilot: o.pilot,
    };
  },

  sessionGroup(g: SaverSessionGroupDTO) {
    return {
      groupJid: g.groupJid,
      name: g.name,
      saved: g.saved,
      savedGroupId: g.savedGroupId,
      lastScannedAt: iso(g.lastScannedAt),
      lastScanStatus: g.lastScanStatus,
      memberCount: g.memberCount,
      kind: g.kind,
      selectable: g.selectable,
      unselectableReason: g.unselectableReason,
    };
  },

  extraction(e: SaverExtractionDTO) {
    return {
      id: e.id,
      sessionId: e.sessionId,
      trigger: e.trigger,
      status: e.status,
      totalGroups: e.totalGroups,
      doneGroups: e.doneGroups,
      failedGroups: e.failedGroups,
      membersFound: e.membersFound,
      newContacts: e.newContacts,
      createdAt: e.createdAt.toISOString(),
      finishedAt: iso(e.finishedAt),
    };
  },

  cancelled(c: CancelSaverExtractionOutput) {
    return { extraction: SaverPresenter.extraction(c.extraction), cancelledItems: c.cancelledItems };
  },

  group(g: SaverGroupDTO) {
    return {
      id: g.id,
      groupJid: g.groupJid,
      name: g.name,
      sessionId: g.sessionId,
      memberCount: g.memberCount,
      phoneCount: g.phoneCount,
      lidOnlyCount: g.lidOnlyCount,
      lastScannedAt: iso(g.lastScannedAt),
      lastScanStatus: g.lastScanStatus,
      createdAt: g.createdAt.toISOString(),
    };
  },

  config(c: SaverConfigDTO) {
    return {
      namePrefix: c.namePrefix,
      excludeAdminsByDefault: c.excludeAdminsByDefault,
      defaultFormat: c.defaultFormat,
      autoRefresh: c.autoRefresh,
      autoRefreshAvailable: c.autoRefreshAvailable,
      configured: c.configured,
      updatedAt: iso(c.updatedAt),
    };
  },

  exportGrant(g: SaverExportGrantDTO) {
    return { userId: g.userId, name: g.name, email: g.email, canExport: g.canExport };
  },

  // ── Base da plataforma (só super admin) ──
  platformContact(c: PlatformSaverContactRow) {
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      lid: c.lid,
      tenantCount: c.tenantCount,
      groupCount: c.groupCount,
      firstSeenAt: c.firstSeenAt.toISOString(),
      lastSeenAt: c.lastSeenAt.toISOString(),
      firstExtractedAt: iso(c.firstExtractedAt),
      lastExtractedAt: iso(c.lastExtractedAt),
    };
  },

  platformContacts(out: ListPlatformSaverContactsOutput) {
    return { items: out.items.map(SaverPresenter.platformContact), nextCursor: out.nextCursor };
  },

  platformTenants(out: ListPlatformSaverTenantsOutput) {
    return { items: out.items.map((t) => ({ id: t.id, name: t.name })), nextCursor: out.nextCursor };
  },

  platformContactLink(l: PlatformSaverContactLink) {
    return {
      tenantId: l.tenantId,
      tenantName: l.tenantName,
      groupId: l.groupId,
      groupName: l.groupName,
      name: l.name,
      isAdmin: l.isAdmin,
      firstExtractedAt: l.firstExtractedAt.toISOString(),
      lastExtractedAt: l.lastExtractedAt.toISOString(),
      leftAt: iso(l.leftAt),
    };
  },
};
