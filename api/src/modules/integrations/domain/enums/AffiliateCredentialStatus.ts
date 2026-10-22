/** `INACTIVE` pausa o uso da credencial sem apagar a chave. */
export const AFFILIATE_CREDENTIAL_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type AffiliateCredentialStatus = (typeof AFFILIATE_CREDENTIAL_STATUSES)[number];
