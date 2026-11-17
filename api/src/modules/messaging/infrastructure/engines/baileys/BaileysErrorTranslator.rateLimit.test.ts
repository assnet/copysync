import { describe, it, expect } from 'vitest';
import { translateEngineError } from './BaileysErrorTranslator';
import { EngineRateLimitedError } from '../../../../../shared/errors/internal/MessagingErrors';
import { fromWireError, toWireError } from '../../remote/engineErrorWire';

// Formato do erro de IQ da lib (`assertNodeErrorFree`): Boom 500 com o código do WhatsApp em `data`.
const iqError = (text: string, code: number) =>
  Object.assign(new Error(text), { isBoom: true, output: { statusCode: 500 }, data: code });

describe('translateEngineError — limite de taxa', () => {
  it('rate-overlimit (429 em data) vira EngineRateLimitedError 429', () => {
    const err = translateEngineError(iqError('rate-overlimit', 429));
    expect(err).toBeInstanceOf(EngineRateLimitedError);
    expect(err.code).toBe('ENGINE_RATE_LIMITED');
    expect(err.statusCode).toBe(429);
  });

  it('reconhece só pelo código ou só pelo texto', () => {
    expect(translateEngineError(iqError('Unknown error', 429))).toBeInstanceOf(EngineRateLimitedError);
    expect(translateEngineError(iqError('rate-overlimit', Number.NaN))).toBeInstanceOf(EngineRateLimitedError);
  });

  it('outro erro de IQ segue indisponível temporário', () => {
    expect(translateEngineError(iqError('item-not-found', 404)).code).toBe('ENGINE_TEMPORARILY_UNAVAILABLE');
  });

  it('atravessa o fio entre processos com a mesma classe', () => {
    const back = fromWireError(toWireError(new EngineRateLimitedError()));
    expect(back).toBeInstanceOf(EngineRateLimitedError);
    expect(back.statusCode).toBe(429);
  });
});
