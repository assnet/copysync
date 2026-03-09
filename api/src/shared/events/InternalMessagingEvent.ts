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
      from: string;
      body: string;
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
    };

export type InternalEventType = InternalMessagingEvent['type'];
