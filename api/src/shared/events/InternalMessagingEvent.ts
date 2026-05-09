/**
 * All internal events emitted by the messaging subsystem.
 * The rest of the application ONLY consumes these — never raw engine events.
 */
export type InternalMessagingEvent =
  | { type: 'SESSION_CREATED'; sessionId: string; tenantId: string }
  | { type: 'SESSION_CONNECTING'; sessionId: string; tenantId: string }
  | { type: 'SESSION_CONNECTED'; sessionId: string; tenantId: string }
  | { type: 'SESSION_DISCONNECTED'; sessionId: string; tenantId: string; reason?: string }
  | { type: 'SESSION_LOGGED_OUT'; sessionId: string; tenantId: string }
  | { type: 'SESSION_QR_UPDATED'; sessionId: string; tenantId: string; qrCode: string }
  | {
      type: 'SESSION_PAIRING_CODE_UPDATED';
      sessionId: string;
      tenantId: string;
      pairingCode: string;
    }
  | {
      type: 'MESSAGE_RECEIVED';
      sessionId: string;
      tenantId: string;
      /** Phone number extracted from the JID (e.g. "5511999887766") */
      from: string;
      /** Contact display name pushed by the WhatsApp client, if available */
      fromName?: string;
      body: string | null;
      /** Message type detected from Baileys payload */
      msgType?: string;
      /** CDN/media URL if available */
      mediaUrl?: string | null;
      mimeType?: string | null;
      fileName?: string | null;
      durationSeconds?: number | null;
      isDeleted?: boolean;
      quotedMessageId?: string | null;
      /** Unique message ID from the engine (used for deduplication) */
      externalMessageId?: string;
      /** true = sent by us from the phone (OUTBOUND); false/undefined = received (INBOUND) */
      fromMe?: boolean;
      /** true = mensagem proveniente de um grupo */
      isGroup?: boolean;
      /** JID numérico do grupo (sem @g.us), quando isGroup=true */
      groupJid?: string;
      /** Nome do grupo, quando isGroup=true */
      groupName?: string;
      /** Phone do membro do grupo que enviou a mensagem */
      participant?: string;
      /** Nome exibido do membro do grupo que enviou a mensagem */
      participantName?: string;
      /** Raw engine payload — never use outside the adapter */
      raw?: unknown;
    }
  | { type: 'MESSAGE_SENT'; sessionId: string; tenantId: string; messageId: string }
  | { type: 'MESSAGE_DELIVERED'; sessionId: string; tenantId: string; messageId: string }
  | { type: 'MESSAGE_READ'; sessionId: string; tenantId: string; messageId: string }
  | {
      type: 'MESSAGE_FAILED';
      sessionId: string;
      tenantId: string;
      messageId?: string;
      reason: string;
    }
  | {
      type: 'PRESENCE_UPDATED';
      sessionId: string;
      tenantId: string;
      /** Phone number extracted from the JID (e.g. "5511999887766") */
      phone: string;
      /** 'available' | 'unavailable' | 'composing' | 'recording' */
      presence: string;
    }
  | {
      type: 'CONTACT_AVATAR_UPDATED';
      tenantId: string;
      phone: string;
      avatarUrl: string;
    }
  | {
      type: 'GROUP_AVATAR_UPDATED';
      tenantId: string;
      /** JID numérico do grupo (sem @g.us) */
      groupJid: string;
      avatarUrl: string;
    };

export type InternalEventType = InternalMessagingEvent['type'];
