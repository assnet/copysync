import type { FastifyRequest } from 'fastify';
import { resolveMembership } from '../../../../shared/http/hooks/resolveMembership';
import { SaverUnavailableError } from '../../../../shared/errors/internal/SaverExportErrors';
import { SAVER_AUDIENCE_KEY } from '../../../tenants/domain/featureAudience';
import { saverAudience } from '../../infrastructure/saverContainer';

/*
 * Audiência do Saver (SAVER-47, design §2.3). Chave `saver` em `platform_settings.feature_audience`, lida a cada
 * pedido (nunca gravada = `SAVER_AUDIENCE`). Ligada: só super admin. Desligada: passa (quem decide é o gate de
 * produto, que roda antes). Não olha entitlement: o cadeado vem do acesso por produto.
 */

const superAdminOnly = (): Promise<boolean> => saverAudience.reader().superAdminOnly(SAVER_AUDIENCE_KEY);

/** preHandler das rotas `/saver/*`, logo após o gate de produto. Fora → 403 `SAVER_UNAVAILABLE` (lança, AGENTS §14). */
export async function saverAudienceHook(request: FastifyRequest): Promise<void> {
  if (request.user?.isSuperAdmin === true) return;
  if (await superAdminOnly()) throw new SaverUnavailableError();
}

/**
 * `GET /saver/access` (só `authHook`): diz ao painel se o item Saver aparece, sem 403. Ligada → só super admin.
 * Aberta → `true` para membro válido do tenant do `X-Tenant-Id` (mesma validação do `tenantHook`); sem header ou
 * membro inválido = invisível.
 */
export async function isSaverVisible(request: FastifyRequest): Promise<boolean> {
  const { userId, isSuperAdmin } = request.user;
  if (isSuperAdmin === true) return true;
  if (await superAdminOnly()) return false;
  const header = request.headers['x-tenant-id'];
  if (typeof header !== 'string' || !header) return false;
  try {
    await resolveMembership(userId, header, false);
    return true;
  } catch {
    return false;
  }
}
