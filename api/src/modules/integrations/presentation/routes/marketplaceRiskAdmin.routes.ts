import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { createMarketplaceRiskAcceptanceRepository } from '../../infrastructure/marketplaceRiskTransaction';
import { ListMarketplaceRiskAcceptancesUseCase } from '../../application/use-cases/ListMarketplaceRiskAcceptancesUseCase';
import { MarketplaceRiskPresenter } from '../presenters/MarketplaceRiskPresenter';
import { marketplaceRiskAcceptanceListResponse, tenantIdParamSchema } from '../schemas/marketplaceRisk.schema';

let listUc: ListMarketplaceRiskAcceptancesUseCase | null = null;
const list = () => (listUc ??= new ListMarketplaceRiskAcceptancesUseCase(createMarketplaceRiskAcceptanceRepository()));

/** Consulta de aceites do aviso de risco por tenant (super admin). Registrado em /api/admin/tenants. */
export async function marketplaceRiskAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { tenantId: string } }>(
    '/:tenantId/marketplace-risk-acceptances',
    {
      preHandler: [authHook, superAdminHook],
      schema: {
        tags: ['Integrations (admin)'],
        summary: 'Listar aceites do aviso de risco de marketplace de um tenant',
        params: tenantIdParamSchema,
        response: { 200: marketplaceRiskAcceptanceListResponse },
      },
    },
    async (request, reply) => {
      const items = await list().execute(request.params.tenantId);
      httpResponse.ok(reply, MarketplaceRiskPresenter.toList(items));
      return reply;
    },
  );
}
