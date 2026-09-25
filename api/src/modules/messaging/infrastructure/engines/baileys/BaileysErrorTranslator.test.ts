import { describe, it, expect } from 'vitest';
import { translateSendError } from './BaileysErrorTranslator';
import { MediaTooLargeError } from '../../../../../shared/errors/internal/MediaErrors';

// Mesmo formato do Boom da lib (`output.statusCode`), sem depender de @hapi/boom.
const boom = (message: string, statusCode: number) => Object.assign(new Error(message), { output: { statusCode } });

describe('translateSendError — envio de mídia', () => {
  it('upload recusado por todos os servidores vira falha de envio, não erro de motor', () => {
    const err = translateSendError(boom('Media upload failed on all hosts', 500), 'media not accepted by engine');
    expect(err.code).toBe('MESSAGE_SEND_FAILED');
  });

  it('arquivo ausente no disco vira falha de envio', () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    expect(translateSendError(enoent, 'media not accepted by engine').code).toBe('MESSAGE_SEND_FAILED');
  });

  it('sessão desconectada continua erro de sessão', () => {
    expect(translateSendError(new Error('Connection not open'), 'x').code).toBe('SESSION_NOT_CONNECTED');
  });

  it('sessão encerrada pelo WhatsApp continua erro de sessão', () => {
    expect(translateSendError(boom('Intentional Logout', 401), 'x').code).toBe('SESSION_EXPIRED');
  });

  it('erro interno já traduzido passa intacto (ex.: mídia acima do limite)', () => {
    const tooLarge = new MediaTooLargeError('limite', { sizeBytes: 10, maxBytes: 5 });
    expect(translateSendError(tooLarge, 'x')).toBe(tooLarge);
  });
});
