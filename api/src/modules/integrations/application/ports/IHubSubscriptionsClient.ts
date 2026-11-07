import type { HubSubscriptionSnapshot } from '../../domain/services/subscriptionReconcile';

/** Motivo de falha da consulta; nunca carrega corpo da resposta (pode ter dado pessoal). */
export type HubSubscriptionsFailure = 'unauthorized' | 'http_error' | 'timeout' | 'network' | 'invalid_response';

export type HubSubscriptionsResult =
  | { ok: true; snapshot: HubSubscriptionSnapshot }
  | { ok: false; reason: HubSubscriptionsFailure; status?: number };

/** Assinaturas de um cliente na central (`GET /integrations/subscriptions`, M2M). Nunca lança. */
export interface IHubSubscriptionsClient {
  fetchByCustomer(externalUserId: string): Promise<HubSubscriptionsResult>;
}
