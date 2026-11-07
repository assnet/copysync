import type { FastifyInstance, FastifyReply } from 'fastify';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import { RedirectLinkNotFoundError } from '../../../../shared/errors/internal/RedirectLinkErrors';
import type { ResolvedRedirect } from '../../application/use-cases/ResolveRedirectLinkUseCase';
import { redirectLinksContainer } from '../../infrastructure/redirectLinksContainer';
import { redirectSlugParamSchema, resolvedRedirectResponse } from '../schemas/redirectLink.schema';

export interface PublicRedirectRoutesOptions {
  /** Injetável no teste; padrão = use case do container. */
  resolver?: { execute(slug: string): Promise<ResolvedRedirect | null> };
}

type SlugParams = { Params: { slug: string } };
const tags = ['Redirect links (public)'];
const config = { rateLimit: rateLimitPresets.publicRedirect };

/** Sem cache: cada acesso sorteia A/B e conta um clique. */
function publicHeaders(reply: FastifyReply): FastifyReply {
  return reply
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Referrer-Policy', 'no-referrer');
}

/**
 * Rotas públicas (sem auth, sem tenant) dos links da plataforma, em `/api/public/redirects`.
 * Inexistente/inativo = 404 `REDIRECT_LINK_NOT_FOUND` sem detalhe. Ver docs/redirect-links.md.
 */
export async function publicRedirectRoutes(app: FastifyInstance, opts: PublicRedirectRoutesOptions = {}): Promise<void> {
  const resolver = () => opts.resolver ?? redirectLinksContainer.resolve();

  const resolveOr404 = async (slug: string, reply: FastifyReply): Promise<ResolvedRedirect> => {
    publicHeaders(reply);
    const out = await resolver().execute(slug);
    if (!out) throw new RedirectLinkNotFoundError();
    return out;
  };

  app.get<SlugParams>('/:slug', {
    config,
    schema: { tags, summary: 'Destino do link (sorteio A/B no servidor)', params: redirectSlugParamSchema, response: { 200: resolvedRedirectResponse } },
  }, async (request, reply) => {
    const out = await resolveOr404(request.params.slug, reply);
    httpResponse.ok(reply, { url: out.url });
  });

  app.get<SlugParams>('/:slug/go', {
    config,
    schema: { tags, summary: 'Redireciona (302) para o destino do link', params: redirectSlugParamSchema },
  }, async (request, reply) => {
    const out = await resolveOr404(request.params.slug, reply);
    // 302: destino editável; 301 ficaria preso no cache do navegador.
    return reply.redirect(out.url, 302);
  });
}
