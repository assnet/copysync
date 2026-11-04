import { AppError } from '../AppError';

// ── Login Telegram (conta de usuário) ────────────────────────────────────────
// Traduzidos do RPCError da lib no adapter; o resto do sistema só vê estes códigos.

export class TelegramPhoneInvalidError extends AppError {
  constructor() {
    super('TELEGRAM_PHONE_INVALID', 'Telegram rejected the phone number', 422, { field: 'phone' });
  }
}

export class TelegramCodeInvalidError extends AppError {
  constructor() {
    super('TELEGRAM_CODE_INVALID', 'Telegram login code is invalid', 422, { field: 'code' });
  }
}

export class TelegramCodeExpiredError extends AppError {
  constructor() {
    super('TELEGRAM_CODE_EXPIRED', 'Telegram login code expired — request a new one', 422, { field: 'code' });
  }
}

export class TelegramPasswordInvalidError extends AppError {
  constructor() {
    super('TELEGRAM_PASSWORD_INVALID', 'Telegram two-step password is invalid', 422, { field: 'password' });
  }
}

/** Telegram pediu para esperar (`FLOOD_WAIT_X`). `seconds` vai para o painel contar. */
export class TelegramFloodWaitError extends AppError {
  constructor(seconds: number) {
    super('TELEGRAM_FLOOD_WAIT', `Telegram asked to wait ${seconds}s`, 429, { seconds });
  }
}

/** Não há login em andamento para receber código/senha (sessão não pediu código ou já expirou). */
export class TelegramLoginNotPendingError extends AppError {
  constructor(sessionId: string) {
    super('TELEGRAM_LOGIN_NOT_PENDING', `No Telegram login pending for session ${sessionId}`, 409);
  }
}
