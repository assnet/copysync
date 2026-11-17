import type { PlatformSaverContact } from '../entities/SaverEntities';
import type { MergeGroupReadResult } from '../services/mergeGroupRead';
import type { PhonePrefixCount } from '../services/phoneRegions';
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
  /** Código do país (só dígitos). Filtra pelo começo do telefone; contato sem telefone nunca casa. */
  ddi: string | null;
  /** Código de área do Brasil (2 dígitos); só com `ddi = 55`. */
  ddd: string | null;
}

/** Contagem para os indicadores da tela: base inteira e, nos filtros, por prefixo do telefone. */
export interface PlatformSaverContactCounts {
  /** Contatos da base, sem filtro. */
  total: number;
  /** Os que casam com os filtros, agrupados pelos primeiros dígitos do telefone. */
  prefixes: PhonePrefixCount[];
}

export interface PlatformSaverContactRow extends PlatformSaverContact {
  tenantCount: number;
  groupCount: number;
  firstExtractedAt: Date | null;
  lastExtractedAt: Date | null;
}

export interface PlatformSaverContactLink {
  tenantId: string;
  tenantName: string;
  groupId: string;
  groupName: string;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: Date;
  lastExtractedAt: Date;
  leftAt: Date | null;
}

/** Conta com vínculo no Saver (seletor do filtro do super admin). */
export interface PlatformSaverTenant {
  id: string;
  name: string;
}

/** Posição de keyset das contas (`name`, `id` asc). */
export interface PlatformSaverTenantKey {
  name: string;
  id: string;
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
  /**
   * Total da base + contagem dos filtrados por prefixo do telefone (`prefixLength` primeiros dígitos).
   * Leitura com tempo máximo: estourou = `SaverSummaryUnavailableError` (503), nunca trava a tela.
   */
  countByPhonePrefix(filter: PlatformSaverContactFilter, prefixLength: number): Promise<PlatformSaverContactCounts>;
  findLinks(contactId: string): Promise<PlatformSaverContactLink[]>;
  /** Contas com ao menos um vínculo (`name`, `id` asc), por keyset. */
  listTenants(after: PlatformSaverTenantKey | null, limit: number): Promise<PlatformSaverTenant[]>;
  /**
   * Aplica o resultado de `mergeGroupRead` numa transação (lotes de 500, ordenados por chave; fusão sob
   * advisory lock). Insert que bate na unicidade (outro tenant gravou antes) vira update. Devolve os ids
   * finais dos inserts, na ordem de `contactInserts`, e quantos foram realmente criados.
   * Corrida perdida com outra gravação (unicidade, fusão, deadlock) lança `ConcurrentWriteConflictError` (retentável).
   * Na mesma transação, nesta ordem: trava do tenant, item (`FOR UPDATE`), grupo. Claim perdido (item
   * cancelado/retomado) ou grupo removido durante a leitura = `CLAIM_LOST`; o teto `saver_contacts` é recontado
   * sob a trava do tenant e `fitsContacts` falso = `LIMIT_REACHED`. Nos dois casos nada é gravado.
   */
  applyGroupRead(
    tenantId: string,
    groupId: string,
    result: MergeGroupReadResult,
    claim: SaverItemClaim,
    fitsContacts: (usage: SaverContactUsage) => boolean,
  ): Promise<ApplyGroupReadOutcome>;
}

/**
 * Teto = contatos DISTINTOS vinculados ao tenant (grupos ativos). Já vinculado não consome; contato da base
 * (de outro tenant) consome no primeiro vínculo; insert novo sempre consome.
 */
export interface SaverContactUsage {
  used: number;
  adding: number;
}

export type ApplyGroupReadOutcome =
  | { status: 'APPLIED'; insertedIds: string[]; created: number }
  | { status: 'CLAIM_LOST' }
  | { status: 'LIMIT_REACHED' };
