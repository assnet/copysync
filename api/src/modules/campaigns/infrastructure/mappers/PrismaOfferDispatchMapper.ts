import type { OfferDispatch as PrismaOfferDispatch } from '@prisma/client';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import { OFFER_DISPATCH_STATUSES, type OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';

/** Linha crua de `RETURNING *` (colunas camelCase entre aspas; enum chega como texto). */
export interface OfferDispatchRawRow {
  id: string;
  tenantId: string;
  offerId: string;
  conversationId: string;
  sessionId: string | null;
  gapSeconds: number;
  waitingSessionSince: Date | null;
  status: string;
  notBefore: Date;
  claimedAt: Date | null;
  claimToken: string | null;
  chatMessageId: string | null;
  failureReason: string | null;
  updatedAt: Date;
}

function toStatus(value: string): OfferDispatchStatus {
  if ((OFFER_DISPATCH_STATUSES as readonly string[]).includes(value)) return value as OfferDispatchStatus;
  throw new Error(`Unknown offer dispatch status: ${value}`);
}

/** Prisma/SQL cru → domínio. */
export class PrismaOfferDispatchMapper {
  static toDomain(raw: PrismaOfferDispatch): OfferDispatch {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      offerId: raw.offerId,
      conversationId: raw.conversationId,
      sessionId: raw.sessionId,
      gapSeconds: raw.gapSeconds,
      waitingSessionSince: raw.waitingSessionSince,
      status: raw.status,
      notBefore: raw.notBefore,
      claimedAt: raw.claimedAt,
      claimToken: raw.claimToken,
      chatMessageId: raw.chatMessageId,
      failureReason: raw.failureReason,
      updatedAt: raw.updatedAt,
    };
  }

  static fromRawRow(row: OfferDispatchRawRow): OfferDispatch {
    return {
      id: row.id,
      tenantId: row.tenantId,
      offerId: row.offerId,
      conversationId: row.conversationId,
      sessionId: row.sessionId,
      gapSeconds: Number(row.gapSeconds),
      waitingSessionSince: row.waitingSessionSince ? new Date(row.waitingSessionSince) : null,
      status: toStatus(row.status),
      notBefore: new Date(row.notBefore),
      claimedAt: row.claimedAt ? new Date(row.claimedAt) : null,
      claimToken: row.claimToken,
      chatMessageId: row.chatMessageId,
      failureReason: row.failureReason,
      updatedAt: new Date(row.updatedAt),
    };
  }
}
