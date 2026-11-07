import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { redirectLinksContainer } from '../../infrastructure/redirectLinksContainer';
import type { RedirectLinkFields } from '../../application/use-cases/redirectLinkInput';
import { RedirectLinkPresenter } from '../presenters/RedirectLinkPresenter';
import {
  createRedirectLinkBodySchema,
  redirectLinkIdParamSchema,
  redirectLinkListResponse,
  redirectLinkResponse,
  updateRedirectLinkBodySchema,
} from '../schemas/redirectLink.schema';

const preHandler = [authHook, superAdminHook];
const tags = ['Redirect links (admin)'];
const uc = () => redirectLinksContainer.adminUseCases();

type IdParams = { Params: { id: string } };
type CreateBody = RedirectLinkFields & { slug: string; urlA: string };

/** Super admin: links de redirecionamento da plataforma. Registrado em `/api/admin/redirect-links`. */
export async function redirectLinkAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Listar links de redirecionamento', response: { 200: redirectLinkListResponse } },
  }, async (_request, reply) => {
    const items = await uc().list.execute();
    httpResponse.ok(reply, { items: items.map(RedirectLinkPresenter.link) });
  });

  app.post<{ Body: CreateBody }>('/', {
    preHandler,
    schema: { tags, summary: 'Criar link de redirecionamento', body: createRedirectLinkBodySchema, response: { 201: redirectLinkResponse } },
  }, async (request, reply) => {
    httpResponse.created(reply, RedirectLinkPresenter.link(await uc().create.execute(request.body)));
  });

  app.patch<IdParams & { Body: RedirectLinkFields }>('/:id', {
    preHandler,
    schema: {
      tags,
      summary: 'Editar link (slug novo desativa o antigo; urlB null volta a 100% A)',
      params: redirectLinkIdParamSchema,
      body: updateRedirectLinkBodySchema,
      response: { 200: redirectLinkResponse },
    },
  }, async (request, reply) => {
    const link = await uc().update.execute({ ...request.body, id: request.params.id });
    httpResponse.ok(reply, RedirectLinkPresenter.link(link));
  });

  app.delete<IdParams>('/:id', {
    preHandler,
    schema: { tags, summary: 'Apagar link de redirecionamento', params: redirectLinkIdParamSchema },
  }, async (request, reply) => {
    await uc().delete.execute(request.params.id);
    httpResponse.noContent(reply);
  });
}
