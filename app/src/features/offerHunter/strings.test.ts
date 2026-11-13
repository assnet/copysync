import { describe, expect, it } from 'vitest';
import { settingsStrings } from '@/features/settings/strings';
import { HUNT_COMMISSION_OPERATORS, HUNT_PRESETS, HUNT_SCORE_FACTOR_KEYS, HUNT_SORTS } from './types';
import { OFFER_HUNTER_RISK_NOTICE_VERSION, offerHunterErrorMessage, offerHunterStrings as t, type HunterRiskProvider } from './strings';

const notices = t.riskNotice;

/**
 * Trava o texto do aviso de risco do caçador de cada marca junto da versão espelhada da API
 * (`OFFER_HUNTER_RISK_NOTICE_VERSION` em `api/.../marketplaceRiskNotice.ts`). Mudou o texto de uma marca?
 * Suba a versão dela aqui e na API (o aceite antigo deixa de valer) e atualize o hash. Separado do aviso
 * do link de afiliado (`settings/strings.test.ts`), que não muda por causa deste.
 */
const LOCKED: Record<HunterRiskProvider, { version: string; sha256: string }> = {
  SHEIN: {
    version: '2026-11-12',
    sha256: '6fe58d63df0468f76b3d5160e7b2520c4068742f607190c894813c6b0ad1c2f9',
  },
  MERCADO_LIVRE: {
    version: '2026-11-13',
    sha256: '203ec7c37a3ef563048bd244e0a0d146590e2df317fc0a9c3da654f96fca961d',
  },
};

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('aviso de risco do caçador', () => {
  it('uma entrada por marca, sem sobra nem falta', () => {
    expect(Object.keys(notices).sort()).toEqual(Object.keys(LOCKED).sort());
    expect(Object.keys(OFFER_HUNTER_RISK_NOTICE_VERSION).sort()).toEqual(Object.keys(LOCKED).sort());
  });

  it.each(Object.keys(LOCKED) as HunterRiskProvider[])('%s: texto pt-BR e versão andam juntos (hash travado)', async (provider) => {
    const notice = notices[provider];
    const hash = await sha256([notice.dialogTitle, ...notice.paragraphs].join('\n'));
    expect({ version: notice.version, sha256: hash }).toEqual(LOCKED[provider]);
    expect(OFFER_HUNTER_RISK_NOTICE_VERSION[provider]).toBe(LOCKED[provider].version);
    expect(notice.scope).toBe('OFFER_HUNTER');
  });

  it('SHEIN cita a automação, as cláusulas dos termos, o encerramento, a retenção e o risco do titular', () => {
    const text = notices.SHEIN.paragraphs.join(' ');
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

  it('MERCADO_LIVRE cita a automação, a proibição nos termos, a suspensão, a retenção e o risco do titular', () => {
    const notice = notices.MERCADO_LIVRE;
    const text = notice.paragraphs.join(' ');
    expect(notice.dialogTitle).toMatch(/Mercado Livre/);
    expect(text).toMatch(/forma automática e recorrente, buscas no painel do Programa de Afiliados do Mercado Livre/);
    expect(text).toMatch(/link de afiliado é gerado automaticamente pela sessão da sua conta de afiliado do Mercado Livre/);
    expect(text).toMatch(/enviada automaticamente ao grupo de destino/);
    expect(text).toMatch(/Termos e Condições do Programa de Afiliados do Mercado Livre proíbem/);
    expect(text).toMatch(/software, bots ou outros meios automatizados/);
    expect(text).toMatch(/suspender ou encerrar a sua conta de afiliado/);
    expect(text).toMatch(/reter as suas comissões/);
    expect(text).toMatch(/por sua conta e risco/);
    expect(text).toMatch(/não se responsabiliza por bloqueio/);
    // Cláusula não confirmada: o aviso não cita número de cláusula nem a outra marca
    expect(text).not.toMatch(/cláusula|SHEIN/i);
  });

  it('versões distintas por marca e diferentes do aviso do link de afiliado', () => {
    const link = settingsStrings.affiliate.riskNotice;
    expect(notices.SHEIN.version).not.toBe(notices.MERCADO_LIVRE.version);
    for (const notice of Object.values(notices)) {
      expect(notice.version).not.toBe(link.version);
      expect(notice.paragraphs.some((p) => link.paragraphs.includes(p))).toBe(false);
    }
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
    expect(t.wizard.steps).toEqual(['Loja', 'O que caçar', 'Refino', 'Quando e onde']);
    expect(t.interval(90)).toBe('1 h 30 min');
    expect(offerHunterErrorMessage({ code: 'OFFER_HUNT_DAILY_LIMIT' })).toBe(t.errors.OFFER_HUNT_DAILY_LIMIT);
    expect(offerHunterErrorMessage({ code: 'DESCONHECIDO' })).toBe(t.errors.generic);
    expect(offerHunterErrorMessage(null)).toBe(t.errors.generic);
  });

  it('nenhum texto leva nome de marca (white label)', () => {
    expect(JSON.stringify(t)).not.toMatch(/copysync|waioprime/i);
  });
});
