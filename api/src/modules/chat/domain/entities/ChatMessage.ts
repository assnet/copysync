import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../enums/ChatMessageEnums';

export interface ChatMessageProps {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: ChatMessageDirection;
  type: ChatMessageType;
  content: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  fileName: string | null;
  durationSeconds: number | null;
  externalMessageId: string | null;
  status: ChatMessageStatus | null;
  isDeleted: boolean;
  quotedMessageId: string | null;
  sentAt: Date | null;
  /** Phone do remetente dentro de um grupo (null para conversas 1-a-1) */
  fromParticipant: string | null;
  /** Nome exibido do remetente dentro de um grupo */
  fromParticipantName: string | null;
  createdAt: Date;
}

export class ChatMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly direction: ChatMessageDirection;
  readonly type: ChatMessageType;
  readonly content: string | null;
  readonly mediaUrl: string | null;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly durationSeconds: number | null;
  readonly externalMessageId: string | null;
  readonly status: ChatMessageStatus | null;
  readonly isDeleted: boolean;
  readonly quotedMessageId: string | null;
  readonly sentAt: Date | null;
  readonly fromParticipant: string | null;
  readonly fromParticipantName: string | null;
  readonly createdAt: Date;

  constructor(props: ChatMessageProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.conversationId = props.conversationId;
    this.direction = props.direction;
    this.type = props.type;
    this.content = props.content;
    this.mediaUrl = props.mediaUrl;
    this.mimeType = props.mimeType;
    this.fileName = props.fileName;
    this.durationSeconds = props.durationSeconds;
    this.externalMessageId = props.externalMessageId;
    this.status = props.status;
    this.isDeleted = props.isDeleted;
    this.quotedMessageId = props.quotedMessageId;
    this.sentAt = props.sentAt;
    this.fromParticipant = props.fromParticipant;
    this.fromParticipantName = props.fromParticipantName;
    this.createdAt = props.createdAt;
  }

  isSystem(): boolean {
    return this.direction === ChatMessageDirection.SYSTEM;
  }

  isInbound(): boolean {
    return this.direction === ChatMessageDirection.INBOUND;
  }

  isOutbound(): boolean {
    return this.direction === ChatMessageDirection.OUTBOUND;
  }
}
