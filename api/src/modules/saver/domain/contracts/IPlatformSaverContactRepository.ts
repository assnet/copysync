import type { PlatformSaverContact } from '../entities/SaverEntities';
import type { MergeGroupReadResult } from '../services/mergeGroupRead';
import type { SaverItemClaim } from './ISaverExtractionQueue';

/**
 * Base da PLATAFORMA (sem `tenantId`). Só use cases `Platform*` (super admin) e a gravação da extração
 * usam este contrato; caminho de tenant usa `ISaverMembershipRepository`.
 */
export interface PlatformSaverContactFilter {
  search: string | null;
  tenantId: string | null;
  from: Date | null;
  to: Date | null;
}

export interface PlatformSaverContactRow extends PlatformSaverContact {
  tenantCount: number;
  groupCount: number;
  firstExtractedAt: Date | null;
  lastExtractedAt: Date | null;
}

export interface PlatformSaverContactLink {
  tenantId: string;
  groupId: string;
  groupName: string;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: Date;
  lastExtractedAt: Date;
  leftAt: Date | null;
}

/** Posição de keyset (`lastSeenAt` desc, `id`); o cursor assinado é da aplicação. */
export interface PlatformSaverContactKey {
  lastSeenAt: Date;
  id: string;
}

export interface IPlatformSaverContactRepository {
  /** Só os contatos cujo `phone`/`lid` está na leitura; nunca a tabela inteira. */
  findByKeys(phones: readonly string[], lids: readonly string[]): Promise<PlatformSaverContact[]>;
  list(
    filter: PlatformSaverContactFilter,
    after: PlatformSaverContactKey | null,
    limit: number,
  ): Promise<PlatformSaverContactRow[]>;
  findLinks(contactId: string): Promise<PlatformSaverContactLink[]>;
  /**
   * Aplica o resultado de `mergeGroupRead` numa transação (lotes de 500, ordenados por chave; fusão sob
   * advisory lock). Insert que bate na unicidade (outro tenant gravou antes) vira update. Devolve os ids
   * finais dos inserts, na ordem de `contactInserts`, e quantos foram realmente criados.
   * Corrida perdida com outra gravação (unicidade, fusão, deadlock) lança `ConcurrentWriteConflictError` (retentável).
   * Na mesma transação trava o item (`FOR UPDATE`) e o grupo: claim perdido (item cancelado/retomado) ou grupo
   * removido durante a leitura devolve `null` sem gravar nada (nenhum vínculo novo para grupo removido).
   */
  applyGroupRead(
    tenantId: string,
    groupId: string,
    result: MergeGroupReadResult,
    claim: SaverItemClaim,
  ): Promise<{ insertedIds: string[]; created: number } | null>;
}
