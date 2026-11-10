import { describe, expect, it } from 'vitest';
import { settingsStrings } from './strings';

const notice = settingsStrings.affiliate.riskNotice;

/**
 * Trava o texto do aviso de risco junto da versão espelhada da API. Mudou o texto? Suba a versão
 * aqui e em `api/.../marketplaceRiskNotice.ts` (o aceite antigo deixa de valer) e atualize o hash.
 */
const LOCKED = {
  version: '2026-11-10',
  sha256: '333fdde343f83d7ce3f0fc9f07747e0fb88392a924a8386da024af3cf4750857',
};

describe('aviso de risco da Shein', () => {
  it('texto pt-BR e versão andam juntos (hash travado)', async () => {
    const bytes = new TextEncoder().encode([notice.dialogTitle, ...notice.paragraphs].join('\n'));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect({ version: notice.version, sha256: hash }).toEqual(LOCKED);
  });

  it('cita proibição nos termos, encerramento da conta, perda de comissão e risco do titular', () => {
    const text = notice.paragraphs.join(' ');
    expect(text).toMatch(/proíbem o uso de bots e de ferramentas automatizadas/);
    expect(text).toMatch(/encerrar a sua conta de afiliado/);
    expect(text).toMatch(/reter as suas comissões/);
    expect(text).toMatch(/por sua conta e risco/);
    expect(text).toMatch(/não se responsabiliza/);
  });
});
