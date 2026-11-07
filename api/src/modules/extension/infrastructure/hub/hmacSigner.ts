import { signM2MRequest, type M2MHeaders } from '../../../../shared/http/m2m/m2mSignature';

export type HubRequestHeaders = M2MHeaders;

/**
 * Headers M2M da saída para a central (outbox da extensão). Mesmo contrato das rotas
 * `/integrations/*`: timestamp em segundos, query ordenada, `X-Signature: sha256=<hex>`.
 * Ver `shared/http/m2m/m2mSignature.ts`.
 */
export function signHubRequest(opts: {
  method: string;
  path: string;
  query?: string;
  body?: string;
  applicationKey: string;
  secret: string;
}): HubRequestHeaders {
  return signM2MRequest(opts);
}
