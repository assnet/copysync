import type {
  LinkRotation as PrismaLinkRotation,
  LinkRotationGroup as PrismaLinkRotationGroup,
} from '@prisma/client';
import type { LinkRotation, LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import type {
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
  LinkRotationStatus,
  LinkRotationStrategy,
} from '../../domain/enums/LinkRotationEnums';

/** Prisma → domínio (rotação e grupos). Enums têm valores idênticos (ver LinkRotationEnums). */
export class PrismaLinkRotationMapper {
  static toDomain(raw: PrismaLinkRotation): LinkRotation {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      sessionId: raw.sessionId,
      domainId: raw.domainId,
      slug: raw.slug,
      status: raw.status as LinkRotationStatus,
      strategy: raw.strategy as LinkRotationStrategy,
      title: raw.title,
      clickCount: raw.clickCount,
      lastClickAt: raw.lastClickAt,
      allFullNotifiedAt: raw.allFullNotifiedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static toDomainWithGroups(raw: PrismaLinkRotation & { groups: PrismaLinkRotationGroup[] }): LinkRotationWithGroups {
    return { ...PrismaLinkRotationMapper.toDomain(raw), groups: raw.groups.map(PrismaLinkRotationMapper.groupToDomain) };
  }

  static groupToDomain(raw: PrismaLinkRotationGroup): LinkRotationGroup {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      rotationId: raw.rotationId,
      conversationId: raw.conversationId,
      groupJid: raw.groupJid,
      position: raw.position,
      weight: raw.weight,
      capacity: raw.capacity,
      inviteCode: raw.inviteCode,
      linkSource: raw.linkSource as LinkRotationGroupLinkSource | null,
      status: raw.status as LinkRotationGroupStatus,
      memberCount: raw.memberCount,
      memberCountAt: raw.memberCountAt,
      clicksSinceSync: raw.clicksSinceSync,
      clickCount: raw.clickCount,
      lastClickAt: raw.lastClickAt,
    };
  }
}
