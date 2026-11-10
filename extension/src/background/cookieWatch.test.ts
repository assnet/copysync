import { describe, it, expect } from 'vitest';
import { cookieChangeAlarm, scheduleDebouncedSync } from './cookieWatch';
import { stubChrome } from '../__mocks__/chromeStub';
import { ML_SYNC_PENDING_ALARM, SHEIN_SYNC_PENDING_ALARM } from './constants';

describe('cookieChangeAlarm', () => {
  it('AT e memberId de m.shein.com agendam o sync da Shein', () => {
    expect(cookieChangeAlarm({ domain: 'm.shein.com', name: 'AT' })).toBe(SHEIN_SYNC_PENDING_ALARM);
    expect(cookieChangeAlarm({ domain: 'm.shein.com', name: 'memberId' })).toBe(SHEIN_SYNC_PENDING_ALARM);
  });

  it('outro cookie de m.shein.com não agenda sync', () => {
    expect(cookieChangeAlarm({ domain: 'm.shein.com', name: 'cookieId' })).toBeNull();
    expect(cookieChangeAlarm({ domain: '.shein.com', name: 'AT' })).toBeNull();
  });

  it('ML continua igual (domínio com ponto, só cookies de identidade)', () => {
    expect(cookieChangeAlarm({ domain: '.mercadolivre.com.br', name: 'ssid' })).toBe(ML_SYNC_PENDING_ALARM);
    expect(cookieChangeAlarm({ domain: '.mercadolivre.com.br', name: '_d2id' })).toBeNull();
    expect(cookieChangeAlarm({ domain: '.mercadolivre.com.br', name: 'AT' })).toBeNull();
  });
});

describe('scheduleDebouncedSync', () => {
  // Comportamento da v3.3 mantido (vale para o ML em produção): alarme já agendado não é reiniciado
  it('agenda quando não há alarme', async () => {
    const stub = stubChrome();
    stub.alarmsGet.mockResolvedValue(undefined);
    await scheduleDebouncedSync(SHEIN_SYNC_PENDING_ALARM);
    expect(stub.alarmsCreate).toHaveBeenCalledWith(SHEIN_SYNC_PENDING_ALARM, { delayInMinutes: 1 });
  });

  it('não reinicia alarme já agendado', async () => {
    const stub = stubChrome();
    stub.alarmsGet.mockResolvedValue({ name: SHEIN_SYNC_PENDING_ALARM, scheduledTime: Date.now() + 30_000 });
    await scheduleDebouncedSync(SHEIN_SYNC_PENDING_ALARM);
    expect(stub.alarmsCreate).not.toHaveBeenCalled();
  });
});
