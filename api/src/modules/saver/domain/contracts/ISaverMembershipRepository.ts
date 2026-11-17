import type { GroupMembershipState } from '../services/mergeGroupRead';

/**
 * Vínculos do TENANT (caminho do tenant até os dados). Todo método filtra `tenantId`; nunca lê
 * `saver_contacts.name` (SAVER-46). Não existe método que devolva linha de contato em JSON de rota.
 */
export interface SaverMembershipExportQuery {
  tenantId: string;
  groupIds: readonly string[];
  onlyWithPhone: boolean;
  onlyActive: boolean;
  excludeAdmins: boolean;
  onePerGroup: boolean;
}

/** Linha de exportação do tenant: nome do vínculo, `phone`/`lid` do contato que ele mesmo leu. */
export interface SaverMembershipExportRow {
  contactId: string;
  name: string | null;
  phone: string | null;
  lid: string | null;
  isAdmin: boolean;
  /** `true` se ainda está em algum dos grupos pedidos (sem `leftAt`). */
  active: boolean;
  /** `MAX(lastExtractedAt)` dos vínculos considerados. */
  extractedAt: Date;
  /** Preenchido só com `onePerGroup`. */
  groupName: string | null;
}

export interface SaverMembershipExportCount {
  total: number;
  withPhone: number;
  lidOnly: number;
}

export interface ISaverMembershipRepository {
  /** Vínculos atuais do grupo do tenant (entrada de `mergeGroupRead`). */
  listGroupMemberships(tenantId: string, groupId: string): Promise<GroupMembershipState[]>;
  /** `COUNT(DISTINCT contactId)` em grupos não removidos (limite `saver_contacts`). */
  countDistinctContacts(tenantId: string): Promise<number>;
  /** Quantos destes contatos ainda NÃO têm vínculo com o tenant (consomem o limite ao entrar). */
  countContactsWithoutTenantLink(tenantId: string, contactIds: readonly string[]): Promise<number>;
  countForExport(query: SaverMembershipExportQuery): Promise<SaverMembershipExportCount>;
  /** Keyset em lotes; o use case consome como gerador (stream). */
  exportBatches(query: SaverMembershipExportQuery, batchSize: number): AsyncIterable<SaverMembershipExportRow[]>;
}
