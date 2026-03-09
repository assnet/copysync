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
  externalMessageId: string | null;
  status: ChatMessageStatus | null;
  sentAt: Date | null;
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
  readonly externalMessageId: string | null;
  readonly status: ChatMessageStatus | null;
  readonly sentAt: Date | null;
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
    this.externalMessageId = props.externalMessageId;
    this.status = props.status;
    this.sentAt = props.sentAt;
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
