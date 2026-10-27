import { describe, it, expect } from 'vitest';
import {
  normalizeBrazilPhone,
  formatBrazilPhone,
  isValidSessionName,
  qrSecondsLeft,
  isQrExpired,
  formatCountdown,
  formatPairingCode,
  QR_TTL_MS,
  QR_EXPIRY_GRACE_MS,
} from './utils';

describe('normalizeBrazilPhone', () => {
  it('aceita DDD + número com 10 ou 11 dígitos', () => {
    expect(normalizeBrazilPhone('11987654321')).toBe('5511987654321');
    expect(normalizeBrazilPhone('1133334444')).toBe('551133334444');
  });

  it('ignora máscara e aceita o 55 na frente', () => {
    expect(normalizeBrazilPhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizeBrazilPhone('+55 11 98765-4321')).toBe('5511987654321');
    expect(normalizeBrazilPhone('551133334444')).toBe('551133334444');
  });

  it('recusa tamanho errado, DDD com zero e celular sem 9', () => {
    expect(normalizeBrazilPhone('987654321')).toBeNull();
    expect(normalizeBrazilPhone('119876543210')).toBeNull();
    expect(normalizeBrazilPhone('01987654321')).toBeNull();
    expect(normalizeBrazilPhone('11887654321')).toBeNull();
    expect(normalizeBrazilPhone('')).toBeNull();
  });
});

describe('formatBrazilPhone', () => {
  it('formata número normalizado e jid', () => {
    expect(formatBrazilPhone('5511987654321')).toBe('+55 (11) 98765-4321');
    expect(formatBrazilPhone('5511987654321:3@s.whatsapp.net')).toBe('+55 (11) 98765-4321');
    expect(formatBrazilPhone('551133334444')).toBe('+55 (11) 3333-4444');
  });

  it('devolve o valor original fora do padrão', () => {
    expect(formatBrazilPhone('14155550100')).toBe('14155550100');
    expect(formatBrazilPhone(null)).toBe('');
  });
});

describe('isValidSessionName', () => {
  it('exige 2 a 40 caracteres úteis', () => {
    expect(isValidSessionName(' a ')).toBe(false);
    expect(isValidSessionName('Ofertas da loja')).toBe(true);
    expect(isValidSessionName('x'.repeat(41))).toBe(false);
  });
});

describe('contagem do QR', () => {
  const t0 = 1_000_000;

  it('conta os segundos restantes sem ficar negativa', () => {
    expect(qrSecondsLeft(t0, t0)).toBe(QR_TTL_MS / 1000);
    expect(qrSecondsLeft(t0, t0 + 1_500)).toBe(QR_TTL_MS / 1000 - 1);
    expect(qrSecondsLeft(t0, t0 + QR_TTL_MS + 5_000)).toBe(0);
  });

  it('só expira depois da folga', () => {
    expect(isQrExpired(t0, t0 + QR_TTL_MS)).toBe(false);
    expect(isQrExpired(t0, t0 + QR_TTL_MS + QR_EXPIRY_GRACE_MS)).toBe(true);
  });

  it('formata m:ss', () => {
    expect(formatCountdown(19)).toBe('0:19');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('formatPairingCode', () => {
  it('separa em 4-4', () => {
    expect(formatPairingCode('abcd1234')).toBe('ABCD-1234');
    expect(formatPairingCode('ABCD-1234')).toBe('ABCD-1234');
  });
});

describe('safeReturnPath / withSessionId', () => {
  it('aceita só caminho interno', async () => {
    const { safeReturnPath } = await import('./utils');
    expect(safeReturnPath('/monitoring')).toBe('/monitoring');
    expect(safeReturnPath('//evil.com')).toBeNull();
    expect(safeReturnPath('https://evil.com')).toBeNull();
    expect(safeReturnPath('/\\evil.com')).toBeNull();
    expect(safeReturnPath('monitoring')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });

  it('acrescenta sessionId respeitando a query', async () => {
    const { withSessionId } = await import('./utils');
    expect(withSessionId('/monitoring', 's 1')).toBe('/monitoring?sessionId=s%201');
    expect(withSessionId('/monitoring?tab=x', 's1')).toBe('/monitoring?tab=x&sessionId=s1');
  });
});
