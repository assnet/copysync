// ── API response types (shapes retornadas pelo backend) ───────────────────────

export type ApiConversationStatus = 'OPEN' | 'PENDING' | 'WAITING' | 'BOT' | 'CLOSED';
export type ApiMessageDirection   = 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
export type ApiMessageType        =
  | 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'VIDEO'
  | 'STICKER' | 'LOCATION' | 'VCARD' | 'CALL_LOG' | 'EVENT';
export type ApiMessageStatus      = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface ChatContactApiDto {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  initials: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupParticipantApiDto {
  /** Telefone em dígitos, ou null quando o participante não o revela. */
  phone: string | null;
  name: string;
  avatarUrl: string | null;
  initials: string;
  isAdmin: boolean;
}

export interface ChatSessionRefApiDto {
  id: string;
  name: string;
  phone: string | null;
}

export interface ChatConversationApiDto {
  id: string;
  tenantId: string;
  channel: string;
  status: ApiConversationStatus;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  queueName: string | null;
  tags: string[];
  notes: string | null;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ChatContactApiDto;
  session: ChatSessionRefApiDto | null;
  assignedUser: { id: string; name: string } | null;
  isGroup?: boolean;
  groupJid?: string | null;
  groupName?: string | null;
  autoDownloadMedia?: boolean;
}

export interface ChatMessageApiDto {
  id: string;
  conversationId: string;
  tenantId: string;
  direction: ApiMessageDirection;
  type: ApiMessageType;
  content: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  fileName: string | null;
  durationSeconds: number | null;
  externalMessageId: string | null;
  status: ApiMessageStatus;
  isDeleted: boolean;
  quotedMessageId: string | null;
  quotedMessage?: {
    id: string;
    type: ApiMessageType;
    content: string | null;
    mediaUrl: string | null;
    direction: ApiMessageDirection;
    isDeleted: boolean;
  } | null;
  sentAt: string;
  createdAt: string;
  fromParticipant?: string | null;
  fromParticipantName?: string | null;
}

// ── Request types ─────────────────────────────────────────────────────────────

export interface ListConversationsParams {
  search?: string;
  status?: ApiConversationStatus;
  sessionId?: string;
  unreadOnly?: boolean;
}

export interface ListMessagesParams {
  limit?: number;
  before?: string;
}

export interface UpdateConversationRequest {
  status?: ApiConversationStatus;
  assignedUserId?: string | null;
  queueName?: string | null;
  tags?: string[];
  notes?: string | null;
  autoDownloadMedia?: boolean;
}

// ── Adapters: API → frontend types ───────────────────────────────────────────

import type {
  ChatConversation,
  ChatMessage,
  ChatParticipant,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
} from '@/features/chat/types';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';

/**
 * Converte status uppercase da API → lowercase do frontend.
 */
export function toFrontendStatus(s: ApiConversationStatus): ConversationStatus {
  return s.toLowerCase() as ConversationStatus;
}

/**
 * Converte status lowercase do frontend → uppercase da API.
 */
export function toApiStatus(s: ConversationStatus): ApiConversationStatus {
  return s.toUpperCase() as ApiConversationStatus;
}

function toMessageDirection(d: ApiMessageDirection): MessageDirection | 'system' {
  if (d === 'INBOUND')  return 'in';
  if (d === 'OUTBOUND') return 'out';
  return 'system';
}

function toMessageStatus(s: ApiMessageStatus): MessageStatus {
  switch (s) {
    case 'SENT':      return 'sent';
    case 'DELIVERED': return 'delivered';
    case 'READ':      return 'read';
    case 'FAILED':    return 'failed';
    default:          return 'sent';
  }
}

const AVATAR_COLORS = [
  '#7c3aed', '#4f70e0', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];

function avatarColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function apiContactToParticipant(dto: ChatContactApiDto): ChatParticipant {
  return {
    id:          dto.id,
    name:        dto.name,
    phone:       dto.phone,
    avatarUrl:   dto.avatarUrl,
    initials:    dto.initials,
    avatarColor: avatarColorFromName(dto.name),
  };
}

export function apiConversationToFrontend(dto: ChatConversationApiDto): ChatConversation {
  return {
    id:            dto.id,
    contact:       apiContactToParticipant(dto.contact),
    session:       dto.session
      ? { id: dto.session.id, name: dto.session.name, phone: dto.session.phone ?? '' }
      : null,
    status:        toFrontendStatus(dto.status),
    unreadCount:   dto.unreadCount,
    lastMessage:   dto.lastMessagePreview ?? '',
    lastMessageAt: dto.lastMessageAt ?? dto.createdAt,
    tags:          dto.tags,
    assignedTo:    dto.assignedUser?.name ?? null,
    notes:         dto.notes ?? '',
    queue:         dto.queueName,
    isGroup:       dto.isGroup ?? false,
    groupJid:      dto.groupJid ?? null,
    groupName:     dto.groupName ?? null,
    autoDownloadMedia: dto.autoDownloadMedia ?? false,
  };
}

export function apiMessageToFrontend(dto: ChatMessageApiDto): ChatMessage {
  const dir = toMessageDirection(dto.direction);
  const quotedMessage = dto.quotedMessage
    ? {
        id:        dto.quotedMessage.id,
        type:      dto.quotedMessage.type.toLowerCase() as ChatMessage['type'],
        body:      dto.quotedMessage.content,
        mediaUrl:  resolveMediaUrl(dto.quotedMessage.mediaUrl),
        direction: toMessageDirection(dto.quotedMessage.direction) === 'system' ? ('out' as const) : (toMessageDirection(dto.quotedMessage.direction) as 'in' | 'out'),
        isDeleted: dto.quotedMessage.isDeleted,
      }
    : undefined;

  return {
    id:              dto.id,
    conversationId:  dto.conversationId,
    type:            dto.type.toLowerCase() as ChatMessage['type'],
    direction:       dir === 'system' ? 'out' : dir,
    body:            dto.content,
    mediaUrl:        resolveMediaUrl(dto.mediaUrl),
    mimeType:        dto.mimeType,
    fileName:        dto.fileName,
    durationSeconds: dto.durationSeconds,
    timestamp:       dto.sentAt ?? dto.createdAt,
    status:          toMessageStatus(dto.status),
    isEvent:         dto.direction === 'SYSTEM',
    isDeleted:       dto.isDeleted,
    quotedMessageId: dto.quotedMessageId,
    quotedMessage,
    fromParticipant:     dto.fromParticipant ?? null,
    fromParticipantName: dto.fromParticipantName ?? null,
  };
}
