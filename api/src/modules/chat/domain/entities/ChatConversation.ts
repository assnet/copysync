import { ConversationStatus } from '../enums/ConversationStatus';

export interface ChatConversationProps {
  id: string;
  tenantId: string;
  sessionId: string | null;
  /** null para conversas de grupo */
  contactId: string | null;
  externalChatId: string | null;
  channel: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  assignedUserId: string | null;
  queueName: string | null;
  tags: string[];
  notes: string | null;
  isGroup: boolean;
  groupJid: string | null;
  groupName: string | null;
  groupAvatarUrl: string | null;
  autoDownloadMedia: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ChatConversation {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string | null;
  /** null para conversas de grupo */
  readonly contactId: string | null;
  readonly externalChatId: string | null;
  readonly channel: string;
  readonly status: ConversationStatus;
  readonly unreadCount: number;
  readonly lastMessageAt: Date | null;
  readonly lastMessagePreview: string | null;
  readonly assignedUserId: string | null;
  readonly queueName: string | null;
  readonly tags: string[];
  readonly notes: string | null;
  readonly isGroup: boolean;
  readonly groupJid: string | null;
  readonly groupName: string | null;
  readonly groupAvatarUrl: string | null;
  readonly autoDownloadMedia: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: ChatConversationProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.sessionId = props.sessionId;
    this.contactId = props.contactId;
    this.externalChatId = props.externalChatId;
    this.channel = props.channel;
    this.status = props.status;
    this.unreadCount = props.unreadCount;
    this.lastMessageAt = props.lastMessageAt;
    this.lastMessagePreview = props.lastMessagePreview;
    this.assignedUserId = props.assignedUserId;
    this.queueName = props.queueName;
    this.tags = props.tags;
    this.notes = props.notes;
    this.isGroup = props.isGroup;
    this.groupJid = props.groupJid;
    this.groupName = props.groupName;
    this.groupAvatarUrl = props.groupAvatarUrl;
    this.autoDownloadMedia = props.autoDownloadMedia;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isOpen(): boolean {
    return this.status === ConversationStatus.OPEN;
  }

  isClosed(): boolean {
    return this.status === ConversationStatus.CLOSED;
  }
}
