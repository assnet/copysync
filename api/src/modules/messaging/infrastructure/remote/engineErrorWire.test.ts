import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors/AppError';
import * as GroupErrors from '../../../../shared/errors/internal/GroupErrors';
import * as MediaErrors from '../../../../shared/errors/internal/MediaErrors';
import * as MessagingErrors from '../../../../shared/errors/internal/MessagingErrors';
import * as SessionErrors from '../../../../shared/errors/internal/SessionErrors';
import * as TelegramErrors from '../../../../shared/errors/internal/TelegramErrors';
import { fromWireError, isWireRegistered, toWireError } from './engineErrorWire';

const S = SessionErrors;
const M = MessagingErrors;
const samples: AppError[] = [
  new S.SessionNotFoundError('s1'),
  new S.SessionAlreadyConnectedError('s1'),
  new S.SessionNotConnectedError('s1'),
  new S.SessionExpiredError('s1'),
  new S.InvalidSessionStateError('s1', 'CONNECTING'),
  new S.SessionPhoneInvalidError('phone'),
  new S.SessionLeaseHeldError('s1'),
  new S.SessionNotOwnedError('s1'),
  new M.MessageSendFailedError('boom'),
  new M.EngineNotReadyError(),
  new M.EngineTemporarilyUnavailableError(),
  new M.EngineCommandOutcomeUnknownError(),
  new M.RecoverableConnectionError('x'),
  new M.PairingFailedError('x'),
  new M.EngineDisabledError('telegram'),
  new M.EngineOperationUnsupportedError('whatsapp', 'submitLoginCode'),
  new MediaErrors.MediaTooLargeError(undefined, { maxBytes: 10, filePath: '/tmp/a' }),
  new MediaErrors.UnsupportedMediaTypeError(),
  new MediaErrors.MediaProcessingFailedError(),
  new MediaErrors.MediaProcessorUnavailableError(),
  new MediaErrors.UploadNotFoundError(),
  new MediaErrors.UploadIncompleteError(),
  new MediaErrors.UploadInProgressError(),
  new MediaErrors.InsufficientStorageError(),
  new MediaErrors.MediaNotFoundError(),
  new TelegramErrors.TelegramPhoneInvalidError(),
  new TelegramErrors.TelegramCodeInvalidError(),
  new TelegramErrors.TelegramCodeExpiredError(),
  new TelegramErrors.TelegramPasswordInvalidError(),
  new TelegramErrors.TelegramFloodWaitError(42),
  new TelegramErrors.TelegramLoginNotPendingError('s1'),
  new GroupErrors.GroupInviteNotAllowedError(),
  new GroupErrors.GroupNotPostableError('g@g.us'),
];

/** Simula o transporte: o fio só leva JSON. */
const roundTrip = (err: unknown) => fromWireError(JSON.parse(JSON.stringify(toWireError(err))));

describe('engineErrorWire', () => {
  it.each(samples.map((e) => [e.constructor.name, e] as const))('%s: ida e volta preserva classe, code, status, meta', (_, err) => {
    const back = roundTrip(err);
    expect(back.constructor).toBe(err.constructor);
    expect(back).toBeInstanceOf(AppError);
    expect(back).toMatchObject({ code: err.code, statusCode: err.statusCode, message: err.message, name: err.name });
    expect(back.meta).toEqual(err.meta);
    expect(back.stack).not.toContain('engineErrorWire');
  });

  it('campo próprio (sessionId) volta e SessionLeaseHeldError não vira a classe base', () => {
    const back = roundTrip(new S.SessionLeaseHeldError('s9'));
    expect(back).toBeInstanceOf(S.SessionLeaseHeldError);
    expect((back as InstanceType<typeof S.SessionLeaseHeldError>).sessionId).toBe('s9');
    expect(roundTrip(new M.EngineTemporarilyUnavailableError())).not.toBeInstanceOf(S.SessionLeaseHeldError);
    expect((roundTrip(new S.SessionNotOwnedError('s2')) as InstanceType<typeof S.SessionNotOwnedError>).sessionId).toBe('s2');
  });

  it('todas as classes AppError dos módulos registrados estão no registro', () => {
    for (const mod of [SessionErrors, MessagingErrors, MediaErrors, TelegramErrors, GroupErrors]) {
      for (const value of Object.values(mod)) {
        if (typeof value === 'function' && value.prototype instanceof AppError) {
          expect(isWireRegistered(value as typeof AppError), value.name).toBe(true);
        }
      }
    }
  });

  it('Error cru não vaza message nem stack', () => {
    const raw = new Error('connect ECONNREFUSED /var/secret/creds.json');
    const wire = toWireError(raw);
    expect(JSON.stringify(wire)).not.toMatch(/ECONNREFUSED|secret|at /);
    expect(wire).toMatchObject({ code: 'ENGINE_TEMPORARILY_UNAVAILABLE', statusCode: 503 });
    const back = fromWireError(wire);
    expect(back).toBeInstanceOf(M.EngineTemporarilyUnavailableError);
    expect(back.message).toBe('Messaging engine temporarily unavailable');
    expect(toWireError('string')).toMatchObject({ code: 'ENGINE_TEMPORARILY_UNAVAILABLE' });
  });

  it('código desconhecido ou fio inválido → ENGINE_TEMPORARILY_UNAVAILABLE', () => {
    for (const w of [
      { code: 'WHATEVER', message: 'raw lib text', statusCode: 400 },
      { code: 'AUTH_INVALID_CREDENTIALS', message: 'x', statusCode: 401 },
      null,
      'nope',
      { code: 'SESSION_NOT_FOUND' },
    ]) {
      const back = fromWireError(w);
      expect(back).toBeInstanceOf(M.EngineTemporarilyUnavailableError);
      expect(back.constructor).toBe(M.EngineTemporarilyUnavailableError);
      expect(back.message).toBe('Messaging engine temporarily unavailable');
    }
  });

  it('name incoerente com code cai na classe do code; status vem da classe', () => {
    const back = fromWireError({ code: 'SESSION_NOT_FOUND', message: 'm', statusCode: 99, name: 'GroupNotPostableError' });
    expect(back).toBeInstanceOf(S.SessionNotFoundError);
    expect(back.statusCode).toBe(404);
  });
});
