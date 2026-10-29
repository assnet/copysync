import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import type { ResolvePublicLinkInput, ResolvePublicLinkOutput } from '../../application/use-cases/ResolvePublicLinkUseCase';
import { verifyProbeToken } from '../../application/use-cases/admin/probeToken';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import { PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import { matchPublicHost, normalizeHost, type PublicHostMatch } from '../../domain/services/publicHost';
import { isPlatformHostname, PLATFORM_HOSTNAMES } from '../../application/use-cases/admin/linkDomainRules';
import { publicPageCsp, publicPageCspForStyle } from '../templates/publicLinkLayout';
import {
  allFullPage,
  botPreviewPage,
  notFoundPage,
  tooManyRequestsPage,
  pausedPage,
  redirectPage,
  unavailablePage,
} from '../templates/publicLinkPages';

/**
 * Página servida por subdomínio além do rodízio (ex.: página de ofertas). Tipo estrutural: o
 * dono implementa sem este módulo importar a implementação. null = nome não é dele (→ 404).
 */
export interface PublicPageRenderer {
  render(address: { domainId: string; slug: string }): Promise<{
    status: number;
    html: string;
    /** `sha256-<base64>` do `<style>` da resposta (vai para a CSP). */
    styleHash: string;
    /** true = `Cache-Control: public, max-age=60`; senão `no-store`. */
    cacheable?: boolean;
  } | null>;
}

export interface PublicLinkDeps {
  /** Domínios ACTIVE em cache (TTL); null = não carregou → nada é interceptado. */
  domains: { get(): Promise<readonly LinkDomain[] | null> };
  resolver: { execute(input: ResolvePublicLinkInput): Promise<ResolvePublicLinkOutput> };
  /** `LINK_PROBE_SECRET`; null = probe sempre 404. */
  probeSecret: string | null;
  /**
   * Hosts da plataforma (API, painel) e subdomínios deles: nunca interceptados, mesmo se um
   * domínio pai (ex. `copysync.app`) for cadastrado como domínio de link. Sem isto a API cai.
   */
  platformHosts?: readonly string[];
  /** Fallback quando o nome não é rodízio (`not_found`), por dono do namespace (design §4.2). */
  pageRenderers?: Partial<Record<PublicSlugKind, PublicPageRenderer>>;
  now?: () => Date;
}

export const PUBLIC_LINK_PATHS = { root: '/', probe: '/.well-known/link-rotation' } as const;
const PUBLIC_PATHS = new Set<string>(Object.values(PUBLIC_LINK_PATHS));

/** Host interceptado: `match` null = sob um domínio de link, mas sem slug válido (ex.: `www.slug.dom`). */
interface PublicHostState { match: PublicHostMatch<LinkDomain> | null }
const publicHosts = new WeakMap<FastifyRequest, PublicHostState>();

function isUnderDomain(host: string, domains: readonly LinkDomain[]): boolean {
  return domains.some((d) => {
    const name = normalizeHost(d.hostname);
    return !!name && (host === name || host.endsWith(`.${name}`));
  });
}

function sendHtml(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', publicPageCsp())
    .type('text/html; charset=utf-8')
    .send(html);
}

const STYLE_HASH = /^sha256-[A-Za-z0-9+/]+={0,2}$/;

/**
 * Envio da página de outro dono: CSP com o hash do `<style>` desta resposta (cores mudam o hash)
 * e cache curto só quando o renderer diz que pode (página com ofertas). Sem `noindex` no
 * cacheável: é a página que o tenant divulga.
 */
function sendRenderedPage(reply: FastifyReply, page: NonNullable<Awaited<ReturnType<PublicPageRenderer['render']>>>): FastifyReply {
  if (!STYLE_HASH.test(page.styleHash)) return sendHtml(reply, 503, unavailablePage());
  const cacheable = page.cacheable === true && page.status === 200;
  reply
    .code(page.status)
    .header('Cache-Control', cacheable ? 'public, max-age=60' : 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', publicPageCspForStyle(page.styleHash));
  if (!cacheable) reply.header('X-Robots-Tag', 'noindex, nofollow');
  return reply.type('text/html; charset=utf-8').send(page.html);
}

function sendEmpty(reply: FastifyReply, status: number): FastifyReply {
  return reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Referrer-Policy', 'no-referrer')
    .send();
}

/** Saída do use case → resposta HTTP (presenter da página). */
function presentResult(reply: FastifyReply, out: ResolvePublicLinkOutput): FastifyReply {
  switch (out.kind) {
    case 'redirect': return sendHtml(reply, 200, redirectPage(out));
    case 'bot_preview': return sendHtml(reply, 200, botPreviewPage(out.title));
    case 'all_full': return sendHtml(reply, 200, allFullPage(out.title));
    case 'paused': return sendHtml(reply, 200, pausedPage(out.title));
    case 'unavailable': return sendHtml(reply, 503, unavailablePage());
    case 'apex':
      if (!out.landingUrl) return sendHtml(reply, 404, notFoundPage());
      // 302: o destino é editável no admin; 301 ficaria preso no cache do navegador.
      return reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow').redirect(out.landingUrl, 302);
    case 'not_found':
    default: return sendHtml(reply, 404, notFoundPage());
  }
}

/**
 * Página pública do rodízio por Host (design.md §4.4/§6), fora do `API_PREFIX`.
 *
 * Hook `onRequest` no escopo raiz: se o Host (sem porta, minúsculo) é um domínio de link ACTIVE
 * ou subdomínio dele, a requisição é pública. Em host público só `GET|HEAD /` e
 * `/.well-known/link-rotation` respondem; qualquer outra rota (inclusive `/health`, `/docs`,
 * `/api/...`) recebe o 404 da marca, sem chegar ao handler da API. Em host da API as duas
 * rotas daqui devolvem o 404 padrão (`callNotFound`).
 *
 * Registrar ANTES das rotas da API e depois de helmet/cors/rate-limit (`app.ts`).
 */
export function registerPublicLinkRoutes(app: FastifyInstance, deps: PublicLinkDeps): void {
  const now = deps.now ?? (() => new Date());
  const platformHosts = deps.platformHosts ?? PLATFORM_HOSTNAMES;

  app.addHook('onRequest', async (request, reply) => {
    const host = normalizeHost(request.headers.host ?? '');
    if (!host || isPlatformHostname(host, platformHosts)) return;
    const domains = await deps.domains.get();
    if (!domains || !isUnderDomain(host, domains)) return;
    publicHosts.set(request, { match: matchPublicHost(host, domains) });
    const method = request.method;
    const url = request.routeOptions.url;
    if ((method === 'GET' || method === 'HEAD') && url && PUBLIC_PATHS.has(url)) return;
    return sendHtml(reply, 404, notFoundPage());
  });

  const routeOptions = {
    schema: { hide: true },
    config: { rateLimit: rateLimitPresets.publicLink },
  };

  // Rotas num escopo filho: o 429 do rate limit vira página HTML só aqui; o resto sobe para o handler da API.
  void app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (error.statusCode === 429 && publicHosts.has(request)) {
        return sendHtml(reply, 429, tooManyRequestsPage());
      }
      throw error;
    });

    scope.get(PUBLIC_LINK_PATHS.root, routeOptions, async (request, reply) => {
      const state = publicHosts.get(request);
      if (!state) return reply.callNotFound();
      if (!state.match) return sendHtml(reply, 404, notFoundPage());
      try {
        const out = await deps.resolver.execute({
          hostname: request.headers.host ?? '',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          now: now(),
        });
        // Rodízio primeiro (clique sem custo extra); nome livre no rodízio → página de ofertas.
        const storefront = deps.pageRenderers?.[PublicSlugKind.STOREFRONT];
        if (out.kind === 'not_found' && state.match.kind === 'slug' && storefront) {
          const page = await storefront.render({ domainId: state.match.domain.id, slug: state.match.slug });
          if (page) return sendRenderedPage(reply, page);
        }
        return presentResult(reply, out);
      } catch (err) {
        request.log.warn({ err: (err as Error)?.name }, 'public link not resolved');
        return sendHtml(reply, 503, unavailablePage());
      }
    });

    scope.get<{ Querystring: { token?: string } }>(PUBLIC_LINK_PATHS.probe, routeOptions, async (request, reply) => {
      const state = publicHosts.get(request);
      if (!state) return reply.callNotFound();
      const domain = state.match?.domain;
      const token = request.query.token;
      const ok = !!domain && !!deps.probeSecret && typeof token === 'string'
        && verifyProbeToken(token, { domainId: domain.id, hostname: domain.hostname }, now(), deps.probeSecret);
      return ok ? sendEmpty(reply, 204) : sendHtml(reply, 404, notFoundPage());
    });
  });
}
