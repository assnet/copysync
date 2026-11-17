import { describe, expect, it } from 'vitest';
import { describeSaverError, saverErrorMessage } from './errors';
import { saverStrings as s } from './strings';
import { filenameFromDisposition } from '@/services/saver.service';

describe('describeSaverError', () => {
  it.each([
    ['PRODUCT_UNAVAILABLE', 'productUnavailable'],
    ['SAVER_UNAVAILABLE', 'productUnavailable'],
    ['FORBIDDEN', 'forbidden'],
    ['SESSION_NOT_CONNECTED', 'sessionNotConnected'],
    ['ENGINE_OPERATION_UNSUPPORTED', 'unsupportedChannel'],
  ])('%s → %s com texto próprio', (code, kind) => {
    const e = describeSaverError({ code, status: 403 });
    expect(e.kind).toBe(kind);
    expect(e.message).toBe(s.errors[code]);
  });

  it('PLAN_LIMIT_REACHED usa chave e teto de meta', () => {
    const e = describeSaverError({ code: 'PLAN_LIMIT_REACHED', status: 403, meta: { key: 'saver_groups', limit: 10 } });
    expect(e).toMatchObject({ kind: 'limitReached', limitKey: 'saver_groups', limit: 10 });
    expect(e.message).toBe(s.limitReached(s.limitKeys.saver_groups!, 10));
  });

  it('PLAN_LIMIT_REACHED com teto 0: o plano não inclui (nunca "limite de 0")', () => {
    const e = describeSaverError({ code: 'PLAN_LIMIT_REACHED', status: 403, meta: { key: 'saver_groups', limit: 0 } });
    expect(e).toMatchObject({ kind: 'limitReached', limit: 0 });
    expect(e.message).toBe(s.limitNotIncluded(s.limitKeys.saver_groups!));
  });

  it('PLAN_LIMIT_REACHED sem meta cai no texto genérico do limite', () => {
    expect(describeSaverError({ code: 'PLAN_LIMIT_REACHED' }).message).toBe(s.errors.PLAN_LIMIT_REACHED);
  });

  it('arquivo sem código: 422 = vazio, 403 = sem permissão', () => {
    expect(describeSaverError({ status: 422 }).kind).toBe('exportEmpty');
    expect(describeSaverError({ status: 403 }).kind).toBe('forbidden');
  });

  it('serviço fora do ar e erro desconhecido', () => {
    expect(describeSaverError({ serviceUnavailable: true }).kind).toBe('serviceUnavailable');
    expect(describeSaverError(new Error('x'))).toMatchObject({ kind: 'other', message: s.errors.generic });
    expect(saverErrorMessage(null)).toBe(s.errors.generic);
  });
});

describe('filenameFromDisposition', () => {
  it('prefere filename* (UTF-8) e cai no filename simples ou no padrão', () => {
    expect(filenameFromDisposition("attachment; filename=\"a.csv\"; filename*=UTF-8''contatos%20%C3%A1.csv", 'x')).toBe('contatos á.csv');
    expect(filenameFromDisposition('attachment; filename="grupos.vcf"', 'x')).toBe('grupos.vcf');
    expect(filenameFromDisposition(undefined, 'contatos.csv')).toBe('contatos.csv');
  });
});
