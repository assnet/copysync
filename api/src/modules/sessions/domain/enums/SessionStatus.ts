export type SessionStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'AWAITING_QR'
  | 'AWAITING_PAIRING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'LOGGED_OUT'
  | 'FAILED';
