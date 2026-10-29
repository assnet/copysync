import type { LinkDomain } from '../entities/LinkDomain';
import type { LinkRotation, LinkRotationWithGroups } from '../entities/LinkRotation';
import type { LinkRotationGroup } from '../entities/LinkRotationGroup';
import type {
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
  LinkRotationStatus,
  LinkRotationStrategy,
} from '../enums/LinkRotationEnums';

export interface CreateLinkRotationInput {
  tenantId: string;
  sessionId: string;
  domainId: string;
  slug: string;
  strategy?: LinkRotationStrategy;
  title?: string | null;
}

export interface UpdateLinkRotationInput {
  /** Sessão diferente da atual apaga os grupos na mesma transação (são da sessão antiga). */
  sessionId?: string;
  slug?: string;
  domainId?: string;
  status?: LinkRotationStatus;
  strategy?: LinkRotationStrategy;
  title?: string | null;
}

export interface SaveLinkRotationGroupInput {
  conversationId: string;
  groupJid: string;
  position: number;
  weight: number;
  capacity: number;
  inviteCode: string | null;
  linkSource: LinkRotationGroupLinkSource | null;
  status: LinkRotationGroupStatus;
}

/** Atualização pontual de um grupo (refresh sob demanda / sync de membros). */
export interface UpdateLinkRotationGroupInput {
  inviteCode?: string | null;
  linkSource?: LinkRotationGroupLinkSource | null;
  status?: LinkRotationGroupStatus;
  memberCount?: number | null;
  memberCountAt?: Date | null;
  clicksSinceSync?: number;
}

/** Leitura da rota pública: rotação + grupos + domínio + se o tenant pode servir o link. */
export interface PublicLinkRotation {
  rotation: LinkRotationWithGroups;
  domain: LinkDomain;
  /** false quando o tenant está suspenso/cancelado. */
  tenantActive: boolean;
}

/** Rotações do tenant. Toda operação tenant-aware recebe `tenantId`. */
export interface ILinkRotationRepository {
  listByTenant(tenantId: string): Promise<LinkRotationWithGroups[]>;
  findById(tenantId: string, id: string): Promise<LinkRotationWithGroups | null>;
  countByTenant(tenantId: string): Promise<number>;
  create(input: CreateLinkRotationInput): Promise<LinkRotation>;
  update(tenantId: string, id: string, input: UpdateLinkRotationInput): Promise<LinkRotation>;
  delete(tenantId: string, id: string): Promise<void>;
  /** Substitui os grupos da rotação (mantém contadores de quem permanece). */
  replaceGroups(
    tenantId: string,
    rotationId: string,
    groups: SaveLinkRotationGroupInput[],
  ): Promise<LinkRotationGroup[]>;
  /** Rota pública: resolve por hostname do domínio + slug. Sem tenant (o Host decide). */
  findPublicByHost(hostname: string, slug: string): Promise<PublicLinkRotation | null>;
  /** Atômico: `clickCount+1` e `clicksSinceSync+1` no grupo, `clickCount+1` na rotação. */
  incrementClick(rotationId: string, groupId: string, at: Date): Promise<void>;
  /** Livre = sem rotação no (domínio, slug) e sem reserva vigente de outro tenant. */
  isSlugAvailable(domainId: string, slug: string, tenantId: string): Promise<boolean>;
  /**
   * Versão em lote de `isSlugAvailable`: devolve, dentre `slugs`, os indisponíveis (ocupados ou
   * reservados para outro tenant). Uma ida ao banco para filtrar sugestões.
   */
  findUnavailableSlugs(domainId: string, slugs: readonly string[], tenantId: string): Promise<string[]>;
  /** Grupo da rotação do tenant; `LinkRotationNotFoundError` se não pertencer. */
  updateGroup(
    tenantId: string,
    rotationId: string,
    groupId: string,
    input: UpdateLinkRotationGroupInput,
  ): Promise<LinkRotationGroup>;
  /** Guarda o nome trocado/excluído com o tenant até `expiresAt` (30 dias). */
  reserveSlug(domainId: string, slug: string, tenantId: string, expiresAt: Date): Promise<void>;
}
