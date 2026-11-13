import { describe, expect, it } from 'vitest';
import { settingsStrings } from '@/features/settings/strings';
import { HUNT_COMMISSION_OPERATORS, HUNT_PRESETS, HUNT_SCORE_FACTOR_KEYS, HUNT_SORTS } from './types';
import { OFFER_HUNTER_RISK_NOTICE_VERSION, offerHunterErrorMessage, offerHunterStrings as t } from './strings';

const notice = t.riskNotice;

/**
 * Trava o texto do aviso de risco do caçador junto da versão espelhada da API
 * (`OFFER_HUNTER_RISK_NOTICE_VERSION.SHEIN` em `api/.../marketplaceRiskNotice.ts`). Mudou o texto?
 * Suba a versão aqui e na API (o aceite antigo deixa de valer) e atualize o hash. Separado do aviso
 * do link de afiliado (`settings/strings.test.ts`), que não muda por causa deste.
 */
const LOCKED = {
  version: '2026-11-12',
  sha256: '6fe58d63df0468f76b3d5160e7b2520c4068742f607190c894813c6b0ad1c2f9',
};

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('aviso de risco do caçador', () => {
  it('texto pt-BR e versão andam juntos (hash travado)', async () => {
    const hash = await sha256([notice.dialogTitle, ...notice.paragraphs].join('\n'));
    expect({ version: notice.version, sha256: hash }).toEqual(LOCKED);
    expect(OFFER_HUNTER_RISK_NOTICE_VERSION).toBe(LOCKED.version);
    expect(notice.scope).toBe('OFFER_HUNTER');
  });

  it('cita a automação, as cláusulas dos termos, o encerramento, a retenção e o risco do titular', () => {
    const text = notice.paragraphs.join(' ');
    expect(text).toMatch(/forma automática e recorrente, buscas no catálogo do Programa de Afiliados da SHEIN/);
    expect(text).toMatch(/link de afiliado é gerado automaticamente pela sessão da sua conta/);
    expect(text).toMatch(/enviada automaticamente ao grupo de destino/);
    expect(text).toMatch(/cláusula 3\.3\.2/);
    expect(text).toMatch(/"sistema, bot ou outro dispositivo ou artifício"/);
    expect(text).toMatch(/Anexo 3, item 6/);
    expect(text).toMatch(/"robôs ou outras ferramentas de consulta automatizadas"/);
    expect(text).toMatch(/"meio automatizado ou scraping"/);
    expect(text).toMatch(/encerrar a sua conta de afiliado/);
    expect(text).toMatch(/reter as suas comissões/);
    expect(text).toMatch(/por sua conta e risco/);
    expect(text).toMatch(/não se responsabiliza por bloqueio/);
  });

  it('é um aviso próprio: não reaproveita texto nem versão do aviso do link de afiliado', () => {
    const shein = settingsStrings.affiliate.riskNotice;
    expect(notice.version).not.toBe(shein.version);
    expect(notice.paragraphs.some((p) => shein.paragraphs.includes(p))).toBe(false);
  });
});

describe('strings do caçador', () => {
  it('cobre predefinições, ordenações, faixas e fatores da API', () => {
    for (const k of HUNT_PRESETS) expect(t.presets[k].label).toBeTruthy();
    for (const k of HUNT_SORTS) expect(t.sorts[k]).toBeTruthy();
    for (const k of HUNT_COMMISSION_OPERATORS) expect(t.wizard.refine.commissionOperators[k].label).toBeTruthy();
    for (const k of HUNT_SCORE_FACTOR_KEYS) expect(t.factors[k].hint).toBeTruthy();
    expect(['GT', 'GTE', 'LT'].map((k) => t.wizard.refine.commissionOperators[k as 'GT'].symbol)).toEqual(['>', '≥', '<']);
  });

  it('uso do dia, assistente e erro por código', () => {
    expect(t.usage.finds(3, 10)).toBe('3 de 10 ofertas garimpadas hoje');
    expect(t.wizard.steps).toEqual(['O que caçar', 'Refino', 'Quando e onde']);
    expect(t.interval(90)).toBe('1 h 30 min');
    expect(offerHunterErrorMessage({ code: 'OFFER_HUNT_DAILY_LIMIT' })).toBe(t.errors.OFFER_HUNT_DAILY_LIMIT);
    expect(offerHunterErrorMessage({ code: 'DESCONHECIDO' })).toBe(t.errors.generic);
    expect(offerHunterErrorMessage(null)).toBe(t.errors.generic);
  });

  it('nenhum texto leva nome de marca (white label)', () => {
    expect(JSON.stringify(t)).not.toMatch(/copysync|waioprime/i);
  });
});
