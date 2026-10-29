import type { LinkDomain } from '../../domain/entities/LinkDomain';
import type { LinkRotation, LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import type {
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
  LinkRotationStatus,
  LinkRotationStrategy,
} from '../../domain/enums/LinkRotationEnums';
import type { LinkRotationSessionRef } from '../../domain/contracts/ILinkRotationSessionReader';
import { inviteUrlFromCode } from '../../domain/services/inviteUrl';

// ── Entrada ──────────────────────────────────────────────────────────────────

export interface CreateLinkRotationDTO {
  tenantId: string;
  sessionId: string;
  domainId: string;
  slug: string;
  strategy?: LinkRotationStrategy;
  title?: string | null;
}

export interface RenameLinkRotationDTO {
  tenantId: string;
  rotationId: string;
  slug: string;
  /** Opcional: troca também o domínio (tem de estar ACTIVE). */
  domainId?: string;
}

export interface UpdateLinkRotationDTO {
  tenantId: string;
  rotationId: string;
  /** Só ACTIVE/PAUSED pelo tenant; PAUSED_BY_PLAN é do sistema. */
  status?: LinkRotationStatus;
  strategy?: LinkRotationStrategy;
  title?: string | null;
  /** Trocar a sessão limpa os grupos. */
  sessionId?: string;
}

export interface LinkRotationGroupInputDTO {
  conversationId: string;
  /** Ordem relativa; o use case renumera 0..n-1. Ausente = ordem da lista. */
  position?: number;
  /** 1–100, default 1. */
  weight?: number;
  /** 50–1024, default 1000. */
  capacity?: number;
  /**
   * Link colado pelo usuário. `undefined` = mantém o manual já salvo (se houver), senão AUTO;
   * `null`/'' = volta para AUTO.
   */
  manualInviteUrl?: string | null;
}

export interface SaveLinkRotationGroupsDTO {
  tenantId: string;
  rotationId: string;
  groups: LinkRotationGroupInputDTO[];
}

export interface RefreshLinkRotationGroupDTO {
  tenantId: string;
  rotationId: string;
  groupId: string;
}

// ── Saída ────────────────────────────────────────────────────────────────────

export interface LinkRotationGroupOutputDTO {
  id: string;
  conversationId: string;
  groupJid: string;
  groupName: string | null;
  position: number;
  weight: number;
  capacity: number;
  inviteUrl: string | null;
  linkSource: LinkRotationGroupLinkSource | null;
  status: LinkRotationGroupStatus;
  memberCount: number | null;
  memberCountAt: Date | null;
  clicksSinceSync: number;
  clickCount: number;
  lastClickAt: Date | null;
}

export interface LinkRotationOutputDTO {
  id: string;
  sessionId: string;
  domainId: string;
  /** Hostname do domínio (null se o domínio sumiu da lista). */
  hostname: string | null;
  slug: string;
  /** `https://<slug>.<hostname>` */
  publicUrl: string | null;
  status: LinkRotationStatus;
  strategy: LinkRotationStrategy;
  title: string | null;
  clickCount: number;
  lastClickAt: Date | null;
  allFullNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  groups: LinkRotationGroupOutputDTO[];
}

export interface LinkDomainOptionDTO {
  id: string;
  hostname: string;
}

export interface LinkRotationSessionDTO {
  id: string;
  name: string;
  status: string;
}

export interface LinkRotationOverviewDTO {
  rotations: LinkRotationOutputDTO[];
  /** Só ACTIVE: os que podem receber rodízio novo. */
  domains: LinkDomainOptionDTO[];
  /** null = ilimitado. */
  limits: { linkRotations: number | null; linkRotationGroups: number | null };
  sessions: LinkRotationSessionDTO[];
}

// ── Mapeamento domínio → DTO ─────────────────────────────────────────────────

export function toLinkRotationGroupDTO(g: LinkRotationGroup, groupName: string | null = null): LinkRotationGroupOutputDTO {
  return {
    id: g.id,
    conversationId: g.conversationId,
    groupJid: g.groupJid,
    groupName,
    position: g.position,
    weight: g.weight,
    capacity: g.capacity,
    inviteUrl: g.inviteCode ? inviteUrlFromCode(g.inviteCode) : null,
    linkSource: g.linkSource,
    status: g.status,
    memberCount: g.memberCount,
    memberCountAt: g.memberCountAt,
    clicksSinceSync: g.clicksSinceSync,
    clickCount: g.clickCount,
    lastClickAt: g.lastClickAt,
  };
}

export function toLinkRotationDTO(
  r: LinkRotation | LinkRotationWithGroups,
  domain: Pick<LinkDomain, 'hostname'> | null,
  groupNames: ReadonlyMap<string, string | null> = new Map(),
): LinkRotationOutputDTO {
  const groups = 'groups' in r ? r.groups : [];
  const hostname = domain?.hostname ?? null;
  return {
    id: r.id,
    sessionId: r.sessionId,
    domainId: r.domainId,
    hostname,
    slug: r.slug,
    publicUrl: hostname ? `https://${r.slug}.${hostname}` : null,
    status: r.status,
    strategy: r.strategy,
    title: r.title,
    clickCount: r.clickCount,
    lastClickAt: r.lastClickAt,
    allFullNotifiedAt: r.allFullNotifiedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    groups: groups.map((g) => toLinkRotationGroupDTO(g, groupNames.get(g.conversationId) ?? null)),
  };
}

export function toLinkRotationSessionDTO(s: LinkRotationSessionRef): LinkRotationSessionDTO {
  return { id: s.id, name: s.name, status: s.status };
}
