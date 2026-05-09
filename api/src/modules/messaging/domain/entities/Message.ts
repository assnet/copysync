export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface MessageProps {
  id: string;
  tenantId: string;
  sessionId: string;
  externalId: string | null;
  direction: MessageDirection;
  status: MessageStatus;
  from: string;
  to: string;
  body: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  failReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Message domain entity — pure, no Prisma dependency.
 */
export class Message {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly sessionId: string;
  public readonly externalId: string | null;
  public readonly direction: MessageDirection;
  public readonly status: MessageStatus;
  public readonly from: string;
  public readonly to: string;
  public readonly body: string | null;
  public readonly mediaUrl: string | null;
  public readonly mediaType: string | null;
  public readonly sentAt: Date | null;
  public readonly deliveredAt: Date | null;
  public readonly readAt: Date | null;
  public readonly failedAt: Date | null;
  public readonly failReason: string | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: MessageProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.sessionId = props.sessionId;
    this.externalId = props.externalId;
    this.direction = props.direction;
    this.status = props.status;
    this.from = props.from;
    this.to = props.to;
    this.body = props.body;
    this.mediaUrl = props.mediaUrl;
    this.mediaType = props.mediaType;
    this.sentAt = props.sentAt;
    this.deliveredAt = props.deliveredAt;
    this.readAt = props.readAt;
    this.failedAt = props.failedAt;
    this.failReason = props.failReason;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
