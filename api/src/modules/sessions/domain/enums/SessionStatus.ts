export type SessionStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'AWAITING_QR'
  | 'AWAITING_PAIRING'
  /** Telegram: código de login enviado ao app do usuário, aguardando digitação. */
  | 'AWAITING_CODE'
  /** Telegram: conta com verificação em duas etapas, aguardando a senha. */
  | 'AWAITING_PASSWORD'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'LOGGED_OUT'
  | 'FAILED';
