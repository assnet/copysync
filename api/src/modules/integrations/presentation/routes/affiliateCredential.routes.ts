import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { tenantHook } from '../../../../shared/http/hooks/tenantHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { PrismaAffiliateCredentialRepository } from '../../infrastructure/repositories/PrismaAffiliateCredentialRepository';
import { ListAffiliateCredentialsUseCase } from '../../application/use-cases/ListAffiliateCredentialsUseCase';
import { UpsertAffiliateCredentialUseCase } from '../../application/use-cases/UpsertAffiliateCredentialUseCase';
import { DeleteAffiliateCredentialUseCase } from '../../application/use-cases/DeleteAffiliateCredentialUseCase';
import { SetAffiliateCredentialStatusUseCase } from '../../application/use-cases/SetAffiliateCredentialStatusUseCase';
import { UpsertAffiliateSessionUseCase } from '../../application/use-cases/UpsertAffiliateSessionUseCase';
import { AffiliateCredentialPresenter } from '../presenters/AffiliateCredentialPresenter';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { AffiliateCredentialStatus } from '../../domain/enums/AffiliateCredentialStatus';
import {
  affiliateCredentialItemResponse,
  affiliateCredentialListResponse,
  affiliateProviderParamSchema,
  affiliateSessionSyncResponse,
  setAffiliateCredentialStatusBodySchema,
  upsertAffiliateCredentialBodySchema,
  upsertAffiliateSessionBodySchema,
} from '../schemas/affiliateCredential.schema';

const repo = new PrismaAffiliateCredentialRepository();
const auditRepo = new PrismaAuditLogRepository();
// Cifra resolvida no uso: sem chave, só quem cifra responde 503.
const cipher = () => SecretCipherFactory.get();

const listUseCase = new ListAffiliateCredentialsUseCase(repo);
const upsertUseCase = new UpsertAffiliateCredentialUseCase(repo, cipher, auditRepo);
const deleteUseCase = new DeleteAffiliateCredentialUseCase(repo, auditRepo);
const setStatusUseCase = new SetAffiliateCredentialStatusUseCase(repo);
const upsertSessionUseCase = new UpsertAffiliateSessionUseCase(repo, cipher, auditRepo);

const preHandler = [authHook, tenantHook];
const tags = ['Integrations'];

type ProviderParams = { Params: { provider: AffiliateProvider } };

/**
 * Credenciais de afiliado por marketplace. Registrado em /api/integrations/affiliate-credentials.
 * Nenhuma resposta carrega segredo; nunca logar o body destas rotas.
 */
export async function affiliateCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Listar credenciais de afiliado do tenant (mascaradas)',
        response: { 200: affiliateCredentialListResponse },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const items = await listUseCase.execute(request.tenantContext.tenantId);
      httpResponse.ok(reply, AffiliateCredentialPresenter.toList(items));
    },
  );

  app.put<ProviderParams & { Body: { publicIdentifier: string; secret?: string } }>(
    '/:provider',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Cadastrar ou editar credencial (secret vazio mantém o atual)',
        params: affiliateProviderParamSchema,
        body: upsertAffiliateCredentialBodySchema,
        response: { 200: affiliateCredentialItemResponse },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      const credential = await upsertUseCase.execute({
        tenantId,
        userId,
        provider: request.params.provider,
        publicIdentifier: request.body.publicIdentifier,
        secret: request.body.secret,
      });
      httpResponse.ok(reply, AffiliateCredentialPresenter.toItem(credential));
    },
  );

  app.delete<ProviderParams>(
    '/:provider',
    {
      preHandler,
      schema: { tags, summary: 'Remover credencial (inclui sessão da extensão)', params: affiliateProviderParamSchema },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      await deleteUseCase.execute({ tenantId, userId, provider: request.params.provider });
      httpResponse.noContent(reply);
    },
  );

  app.patch<ProviderParams & { Body: { status: AffiliateCredentialStatus } }>(
    '/:provider/status',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Ativar ou desativar credencial sem apagar',
        params: affiliateProviderParamSchema,
        body: setAffiliateCredentialStatusBodySchema,
        response: { 200: affiliateCredentialItemResponse },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      const credential = await setStatusUseCase.execute({
        tenantId,
        userId,
        provider: request.params.provider,
        status: request.body.status,
      });
      httpResponse.ok(reply, AffiliateCredentialPresenter.toItem(credential));
    },
  );

  app.put<
    ProviderParams & {
      Body: { cookies: Record<string, string>; csrf?: string; affiliateTag?: string; capturedAt: string };
    }
  >(
    '/:provider/session',
    {
      preHandler,
      schema: {
        tags,
        summary: 'Sincronizar sessão do marketplace (extensão do navegador)',
        params: affiliateProviderParamSchema,
        body: upsertAffiliateSessionBodySchema,
        response: { 200: affiliateSessionSyncResponse },
      },
    },
    async (request, reply) => {
      const { tenantId, userId } = request.tenantContext;
      const credential = await upsertSessionUseCase.execute({
        tenantId,
        userId,
        provider: request.params.provider,
        ...request.body,
      });
      httpResponse.ok(reply, AffiliateCredentialPresenter.toSessionSync(credential));
    },
  );
}
