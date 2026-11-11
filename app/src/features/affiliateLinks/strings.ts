import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import type { AffiliateProvider } from '@/types/api.types';

/**
 * Textos únicos dos erros e avisos de link de afiliado (gerador, vitrine e story).
 * Nome da loja vem de `affiliateProviders.ts`; o artigo fica aqui porque é gramática do texto.
 * Loja desconhecida (ou ausente em `meta.provider`) cai em texto neutro.
 */

/** Gênero do nome da loja em pt-BR: "a Shopee", "o Mercado Livre". */
const ARTICLE: Record<AffiliateProvider, 'a' | 'o'> = {
  SHOPEE: 'a',
  MERCADO_LIVRE: 'o',
  AMAZON: 'a',
  SHEIN: 'a',
};

export function isAffiliateProvider(value: unknown): value is AffiliateProvider {
  return typeof value === 'string' && value in ARTICLE;
}

export function storeName(provider: AffiliateProvider): string {
  return AFFILIATE_PROVIDERS.find((p) => p.provider === provider)?.name ?? provider;
}

/** "A Shopee" / "O Mercado Livre" (início de frase). */
const subject = (p: AffiliateProvider) => `${ARTICLE[p].toUpperCase()} ${storeName(p)}`;
/** "da Shopee" / "do Mercado Livre". */
const ofStore = (p: AffiliateProvider) => `d${ARTICLE[p]} ${storeName(p)}`;

/** Como o usuário conecta cada loja (caminho fixo, sem depender de `meta.reason`). */
const credentialRequired: Record<AffiliateProvider, string> = {
  MERCADO_LIVRE: 'Conecte sua conta do Mercado Livre pela extensão do navegador para gerar o link com a sua comissão.',
  SHEIN: 'Conecte sua conta da Shein pela extensão do navegador para gerar o link com a sua comissão.',
  SHOPEE: 'Cadastre o AppID e a senha da API de afiliados da Shopee para gerar o link com a sua comissão.',
  AMAZON: 'Cadastre seu ID de rastreamento da Amazon para gerar o link com a sua comissão.',
};

/** O que revisar quando a loja recusa a conexão. */
const rejectedHint: Record<AffiliateProvider, string> = {
  MERCADO_LIVRE: 'Conecte a conta de novo pela extensão do navegador.',
  SHEIN: 'Conecte a conta de novo pela extensão do navegador.',
  SHOPEE: 'Revise o AppID e a senha da API de afiliados.',
  AMAZON: 'Revise o ID de rastreamento.',
};

export const affiliateLinkStrings = {
  errors: {
    credentialRequired: (p: AffiliateProvider | null) =>
      p ? credentialRequired[p] : 'Conecte sua conta de afiliado desta loja para gerar o link com a sua comissão.',
    credentialRejected: (p: AffiliateProvider | null) =>
      p ? `${subject(p)} recusou sua conexão. ${rejectedHint[p]}` : 'A loja recusou sua conexão de afiliado. Revise a credencial.',
    /** Shopee sem acesso aprovado à API de afiliados (texto que o gerador já usava). */
    apiAccessDenied:
      'Sua conta de afiliado ainda não tem acesso à Open API. Libere o acesso no painel de afiliado da Shopee e tente de novo.',
    /** Limitou as consultas ou ficou fora do ar: a mesma orientação para os dois. */
    storeUnavailable: (p: AffiliateProvider | null) =>
      `${p ? subject(p) : 'A loja'} não respondeu agora. Tente de novo em instantes.`,
    rebuildFailed: (p: AffiliateProvider | null) =>
      `${p ? subject(p) : 'A loja'} não gerou link para este produto. Confira se ele ainda está à venda.`,
    riskNotAccepted:
      'Para usar links da Shein, um administrador precisa aceitar o aviso de risco em Credenciais de afiliado.',
  },
  actions: {
    connect: (p: AffiliateProvider | null) => (p ? `Conectar ${storeName(p)}` : 'Conectar loja'),
    review: 'Revisar conexão',
    openCredentials: 'Abrir credenciais',
  },
  rebuilt: {
    notice: (p: AffiliateProvider | null) => (p ? `Link recriado com a sua conta ${ofStore(p)}` : 'Link recriado com a sua conta da loja'),
    tooltip: 'O link que você colou foi trocado por um gerado com a sua conta de afiliado. A comissão das vendas vai para você.',
  },
};
