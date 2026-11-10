import { describe, it, expect } from 'vitest';
import {
  providerIdentifierFollowsSession,
  providerRequiresSecret,
  providerUsesSession,
  validatePublicIdentifier,
  validateSecret,
} from './affiliateProviderFields';

describe('affiliateProviderFields', () => {
  it('só a Shopee exige segredo', () => {
    expect(providerRequiresSecret('SHOPEE')).toBe(true);
    expect(providerRequiresSecret('MERCADO_LIVRE')).toBe(false);
    expect(providerRequiresSecret('AMAZON')).toBe(false);
  });

  it('Shopee: AppID numérico e Secret alfanumérico', () => {
    expect(validatePublicIdentifier('SHOPEE', '18301234567')).toBe('18301234567');
    expect(validatePublicIdentifier('SHOPEE', 'abc123')).toBeNull();
    expect(validateSecret('SHOPEE', 'ABCDEF1234567890ABCDEF1234567890')).not.toBeNull();
    expect(validateSecret('SHOPEE', 'curta')).toBeNull();
    expect(validateSecret('SHOPEE', 'com espaço no meio 1234')).toBeNull();
  });

  it('Mercado Livre: etiqueta de afiliado', () => {
    expect(validatePublicIdentifier('MERCADO_LIVRE', 'minha_loja.ofertas')).toBe('minha_loja.ofertas');
    expect(validatePublicIdentifier('MERCADO_LIVRE', 'a')).toBeNull();
    expect(validatePublicIdentifier('MERCADO_LIVRE', 'x'.repeat(65))).toBeNull();
    expect(validateSecret('MERCADO_LIVRE', 'qualquer-coisa-1234567')).toBeNull();
  });

  it('Amazon: ID de rastreamento com sufixo de país', () => {
    expect(validatePublicIdentifier('AMAZON', 'minhaloja-20')).toBe('minhaloja-20');
    expect(validatePublicIdentifier('AMAZON', 'minhaloja')).toBeNull();
    expect(validatePublicIdentifier('AMAZON', '-20')).toBeNull();
  });

  it('faz trim antes de validar e recusa vazio', () => {
    expect(validatePublicIdentifier('AMAZON', '  minhaloja-20 ')).toBe('minhaloja-20');
    expect(validatePublicIdentifier('SHOPEE', '   ')).toBeNull();
    expect(validatePublicIdentifier('MERCADO_LIVRE', '')).toBeNull();
  });
});

describe('affiliateProviderFields — Shein', () => {
  it('ID numérico de 6 a 15 dígitos, sem segredo, via sessão', () => {
    expect(validatePublicIdentifier('SHEIN', ' 1234567890 ')).toBe('1234567890');
    expect(validatePublicIdentifier('SHEIN', '12345')).toBeNull();
    expect(validatePublicIdentifier('SHEIN', '1234567890123456')).toBeNull();
    expect(validatePublicIdentifier('SHEIN', 'affiliate_koc_1')).toBeNull();
    expect(providerRequiresSecret('SHEIN')).toBe(false);
    expect(validateSecret('SHEIN', 'qualquer')).toBeNull();
    expect(providerUsesSession('SHEIN')).toBe(true);
  });

  it('só na Shein o identificador acompanha a sessão', () => {
    expect(providerIdentifierFollowsSession('SHEIN')).toBe(true);
    expect(providerIdentifierFollowsSession('MERCADO_LIVRE')).toBe(false);
    expect(providerIdentifierFollowsSession('SHOPEE')).toBe(false);
    expect(providerIdentifierFollowsSession('AMAZON')).toBe(false);
  });
});
