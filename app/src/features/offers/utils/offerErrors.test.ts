import { describe, expect, it } from 'vitest';
import { toOfferError } from './offerErrors';
import { offerStrings as t } from '../strings';
import { affiliateLinkStrings as common } from '@/features/affiliateLinks/strings';

const limitErr = (key: string, limit: number) => ({ code: 'PLAN_LIMIT_REACHED', meta: { key, limit } });

describe('toOfferError — limite por canal', () => {
  it('grupos de disparo do Telegram citam o canal e abrem o aviso de upgrade', () => {
    const v = toOfferError(limitErr('telegram_broadcast_groups', 5));
    expect(v.message).toContain('Telegram');
    expect(v.planLimit).toEqual({ kind: 'telegramBroadcastGroups', limit: 5 });
  });

  it('destino sem permissão de postar: mensagem própria, sem ação', () => {
    const v = toOfferError({ code: 'GROUP_NOT_POSTABLE' });
    expect(v.message).toBe('Não dá para postar neste grupo. Escolha outro.');
    expect(v.action).toBe('none');
  });

  it('sessões de WhatsApp viram aviso de sessões', () => {
    const v = toOfferError(limitErr('whatsapp_sessions', 1));
    expect(v.message).toContain('WhatsApp');
    expect(v.planLimit?.kind).toBe('whatsappSessions');
  });

  it('limite diário segue sem aviso de upgrade', () => {
    const v = toOfferError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'offers_per_day', limit: 10 } });
    expect(v.planLimit).toBeUndefined();
  });
});

describe('toOfferError — Shein', () => {
  it('Shein fora do plano: texto da Shein, não o de outra função', () => {
    const v = toOfferError({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'marketplace_shein_enabled' } });
    expect(v.message).toContain('Shein');
    expect(v.message).not.toContain('Marcar todos');
    expect(v.isLinkField).toBe(true);
  });

  it('aviso de risco não aceito: explica e leva às credenciais', () => {
    const v = toOfferError({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(v.message).toContain('aviso de risco');
    expect(v.action).toBe('credentials');
  });
});

describe('toOfferError — etiquetas do Mercado Livre', () => {
  it('sem vaga: texto próprio (não o do limite diário) e aviso de upgrade de etiquetas', () => {
    const v = toOfferError(limitErr('mercado_livre_affiliate_tags', 1), 10);
    expect(v.planLimit).toEqual({ kind: 'mercadoLivreTags', limit: 1 });
    expect(v.message).toBe(t.mercadoLivreTagLimit(1, true));
    expect(v.message).not.toBe(t.planLimit(10));
    expect(v.isLinkField).toBe(false);
  });

  it('MAX cheio: texto orienta a desvincular', () => {
    expect(toOfferError(limitErr('mercado_livre_affiliate_tags', 10)).message).toBe(t.mercadoLivreTagLimit(10, false));
  });

  it('sem limite no meta: texto próprio, sem aviso', () => {
    const v = toOfferError({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags' } });
    expect(v.planLimit).toBeUndefined();
    expect(v.message).toBe(t.mercadoLivreTagLimit(null, true));
  });

  it('etiqueta não vinculada com vaga: texto próprio e botão de credenciais', () => {
    const v = toOfferError({ code: 'AFFILIATE_IDENTIFIER_NOT_LINKED', meta: { provider: 'MERCADO_LIVRE', limit: 2, used: 1 } });
    expect(v.action).toBe('credentials');
    expect(v.message).toBe(t.errors.AFFILIATE_IDENTIFIER_NOT_LINKED);
    expect(v.message).not.toBe(t.errors.generic);
    expect(v.isLinkField).toBe(false);
  });
});

describe('toOfferError — link de afiliado (texto comum)', () => {
  it('loja não conectada: texto por loja, botão de credenciais e meta preservado', () => {
    const meta = { provider: 'MERCADO_LIVRE' };
    const v = toOfferError({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta });
    expect(v.message).toBe(common.errors.credentialRequired('MERCADO_LIVRE'));
    expect(v.action).toBe('credentials');
    expect(v.isLinkField).toBe(false);
    expect(v.meta).toEqual(meta);
  });

  it('credencial recusada usa o texto comum', () => {
    const v = toOfferError({ code: 'AFFILIATE_CREDENTIAL_REJECTED', meta: { provider: 'SHOPEE' } });
    expect(v.message).toBe(common.errors.credentialRejected('SHOPEE'));
    expect(v.action).toBe('credentials');
  });

  it.each(['OFFER_LINK_REBUILD_FAILED', 'AFFILIATE_API_RATE_LIMITED', 'AFFILIATE_API_UNAVAILABLE'])('%s fica no campo, sem botão', (code) => {
    const v = toOfferError({ code, meta: { provider: 'AMAZON' } });
    expect(v.isLinkField).toBe(true);
    expect(v.action).toBe('none');
    expect(v.message).toContain('A Amazon');
  });

  it('códigos removidos caem no texto genérico e não são do campo', () => {
    for (const code of ['OFFER_LINK_NOT_OWNED', 'OFFER_LINK_NOT_AFFILIATE']) {
      const v = toOfferError({ code });
      expect(v.message).toBe(t.errors.generic);
      expect(v.isLinkField).toBe(false);
    }
  });

  it('link estranho no texto editado: texto próprio, alerta da página', () => {
    const v = toOfferError({ code: 'OFFER_TEXT_FOREIGN_LINK' });
    expect(v.message).toBe(t.errors.OFFER_TEXT_FOREIGN_LINK);
    expect(v.message).not.toBe(t.errors.generic);
    expect(v.isLinkField).toBe(false);
    expect(v.action).toBe('none');
  });
});
