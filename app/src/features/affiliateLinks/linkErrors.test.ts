import { describe, expect, it } from 'vitest';
import { connectActionLabel, describeAffiliateLinkError } from './linkErrors';

const d = describeAffiliateLinkError;

describe('describeAffiliateLinkError', () => {
  it('código de fora do módulo devolve null', () => {
    expect(d('PLAN_LIMIT_REACHED', { limit: 3 })).toBeNull();
    expect(d('OFFER_URL_UNSUPPORTED')).toBeNull();
    expect(d('AFFILIATE_CREDENTIAL_NOT_FOUND')).toBeNull();
    expect(d(null)).toBeNull();
    expect(d(undefined)).toBeNull();
  });

  it('AFFILIATE_CREDENTIAL_REQUIRED: caminho de conexão por loja, com botão', () => {
    expect(d('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'MERCADO_LIVRE' })).toEqual({
      message: 'Conecte sua conta do Mercado Livre pela extensão do navegador para gerar o link com a sua comissão.',
      action: 'credentials',
    });
    expect(d('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'SHEIN' })?.message).toContain('da Shein pela extensão');
    expect(d('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'SHOPEE' })?.message).toContain('AppID e a senha da API de afiliados da Shopee');
    expect(d('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'AMAZON' })?.message).toContain('ID de rastreamento da Amazon');
  });

  it('loja desconhecida ou ausente cai em texto neutro', () => {
    const view = d('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'OUTRA' });
    expect(view).toEqual({ message: 'Conecte sua conta de afiliado desta loja para gerar o link com a sua comissão.', action: 'credentials' });
    expect(d('AFFILIATE_API_UNAVAILABLE')?.message).toBe('A loja não respondeu agora. Tente de novo em instantes.');
  });

  it('AFFILIATE_CREDENTIAL_REJECTED: artigo certo e o que revisar', () => {
    expect(d('AFFILIATE_CREDENTIAL_REJECTED', { provider: 'SHOPEE' })).toEqual({
      message: 'A Shopee recusou sua conexão. Revise o AppID e a senha da API de afiliados.',
      action: 'credentials',
    });
    expect(d('AFFILIATE_CREDENTIAL_REJECTED', { provider: 'MERCADO_LIVRE' })?.message).toBe(
      'O Mercado Livre recusou sua conexão. Conecte a conta de novo pela extensão do navegador.',
    );
  });

  it('AFFILIATE_API_ACCESS_DENIED mantém o texto do gerador, sem botão', () => {
    expect(d('AFFILIATE_API_ACCESS_DENIED', { provider: 'SHOPEE' })).toEqual({
      message:
        'Sua conta de afiliado ainda não tem acesso à Open API. Libere o acesso no painel de afiliado da Shopee e tente de novo.',
      action: 'none',
    });
  });

  it('RATE_LIMITED e UNAVAILABLE: mesma orientação, sem botão', () => {
    const expected = { message: 'A Amazon não respondeu agora. Tente de novo em instantes.', action: 'none' };
    expect(d('AFFILIATE_API_RATE_LIMITED', { provider: 'AMAZON' })).toEqual(expected);
    expect(d('AFFILIATE_API_UNAVAILABLE', { provider: 'AMAZON' })).toEqual(expected);
  });

  it('OFFER_LINK_REBUILD_FAILED ignora meta.reason e cita a loja', () => {
    expect(d('OFFER_LINK_REBUILD_FAILED', { provider: 'MERCADO_LIVRE', reason: 'qualquer' })).toEqual({
      message: 'O Mercado Livre não gerou link para este produto. Confira se ele ainda está à venda.',
      action: 'none',
    });
  });

  it('MARKETPLACE_RISK_NOT_ACCEPTED leva às credenciais', () => {
    expect(d('MARKETPLACE_RISK_NOT_ACCEPTED')).toEqual({
      message: 'Para usar links da Shein, um administrador precisa aceitar o aviso de risco em Credenciais de afiliado.',
      action: 'credentials',
    });
  });
});

describe('connectActionLabel', () => {
  it('rótulo conforme o erro', () => {
    expect(connectActionLabel('AFFILIATE_CREDENTIAL_REQUIRED', { provider: 'SHOPEE' })).toBe('Conectar Shopee');
    expect(connectActionLabel('AFFILIATE_CREDENTIAL_REQUIRED')).toBe('Conectar loja');
    expect(connectActionLabel('AFFILIATE_CREDENTIAL_REJECTED', { provider: 'SHOPEE' })).toBe('Revisar conexão');
    expect(connectActionLabel('MARKETPLACE_RISK_NOT_ACCEPTED')).toBe('Abrir credenciais');
  });
});
