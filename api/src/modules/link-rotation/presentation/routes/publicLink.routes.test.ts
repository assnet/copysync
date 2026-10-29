import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { rateLimitPresets } from '../../../../shared/http/rateLimitPresets';
import type { ResolvePublicLinkInput, ResolvePublicLinkOutput } from '../../application/use-cases/ResolvePublicLinkUseCase';
import { createProbeToken } from '../../application/use-cases/admin/probeToken';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import { makeDomain, NOW } from '../../application/use-cases/linkRotationTestFakes';
import { ActiveLinkDomainCache } from '../../infrastructure/cache/ActiveLinkDomainCache';
import { configurePublicPageBranding, publicPageCsp } from '../templates/publicLinkLayout';
import { createHash } from 'node:crypto';
import { PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import { registerPublicLinkRoutes, type PublicPageRenderer } from './publicLink.routes';

const SECRET = 'probe-secret-de-teste-com-32-chars!!';
const HOST = 'promo.copysync.com.br';
const DOMAIN = makeDomain();
const INVITE = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';

let app: FastifyInstance;
let next: ResolvePublicLinkOutput;
type Load = () => Promise<LinkDomain[]>;
let resolver: { execute: ReturnType<typeof vi.fn<(i: ResolvePublicLinkInput) => Promise<ResolvePublicLinkOutput>>> };
let load: ReturnType<typeof vi.fn<Load>>;

beforeEach(async () => {
  next = { kind: 'not_found' };
  resolver = { execute: vi.fn(async () => next) };
  load = vi.fn<Load>(async () => [DOMAIN]);
  app = Fastify({ trustProxy: 1 });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  registerPublicLinkRoutes(app, {
    domains: new ActiveLinkDomainCache(load),
    resolver,
    probeSecret: SECRET,
    now: () => NOW,
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/me', async () => ({ me: true }));
  await app.ready();
});

afterEach(async () => { await app.close(); });

const get = (url: string, host = HOST, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { host, 'user-agent': 'Mozilla/5.0', ...headers } });

describe('página pública por Host', () => {
  it('redirect: título, grupo, botão, meta refresh e headers', async () => {
    next = { kind: 'redirect', inviteUrl: INVITE, groupName: 'Ofertas VIP', groupAvatarUrl: null, title: 'Promo da Ana' };
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBe(publicPageCsp());
    expect(publicPageCsp()).not.toContain('unsafe-inline');
    expect(res.body).toContain('<title>Promo da Ana</title>');
    expect(res.body).toContain('<span class="gn" title="Ofertas VIP">Ofertas VIP</span>');
    expect(res.body).toContain('<span class="av av-i" aria-hidden="true">O</span>');
    expect(res.body).toContain(`href="${INVITE}"`);
    expect(res.body).toContain(`content="1;url=${INVITE}"`);
    expect(res.body).toContain('Entrar no grupo');
    expect(resolver.execute).toHaveBeenCalledWith(expect.objectContaining({ hostname: HOST, now: NOW }));
  });

  it('o hash da CSP casa com o <style> da página', async () => {
    const { createHash } = await import('node:crypto');
    next = { kind: 'paused', title: 'x' };
    const css = /<style>(.*?)<\/style>/s.exec((await get('/')).body)![1]!;
    expect(publicPageCsp()).toContain(`'sha256-${createHash('sha256').update(css).digest('base64')}'`);
  });

  it('escapa HTML vindo do banco (título, grupo, url)', async () => {
    next = { kind: 'redirect', inviteUrl: 'https://chat.whatsapp.com/x"><script>', groupName: '<img src=x onerror=1>', groupAvatarUrl: null, title: '</title><script>alert(1)</script>' };
    const res = await get('/');
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain('<img');
    expect(res.body).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(res.body).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('redirect sem nome de grupo', async () => {
    next = { kind: 'redirect', inviteUrl: INVITE, groupName: null, groupAvatarUrl: null, title: 'Promo' };
    expect((await get('/')).body).toContain('Seu convite está pronto.');
  });

  it.each([
    [{ kind: 'all_full', title: 'Promo' } as const, 200, 'Grupos lotados'],
    [{ kind: 'paused', title: 'Promo' } as const, 200, 'Link em pausa'],
    [{ kind: 'unavailable' } as const, 503, 'Link indisponível'],
    [{ kind: 'not_found' } as const, 404, 'Link não encontrado'],
  ])('%o → %i', async (out, status, text) => {
    next = out;
    const res = await get('/');
    expect(res.statusCode).toBe(status);
    expect(res.body).toContain(text);
    expect(res.body).not.toContain('chat.whatsapp.com');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('bot_preview: OG sem convite', async () => {
    next = { kind: 'bot_preview', title: 'Promo da Ana' };
    const res = await get('/', HOST, { 'user-agent': 'WhatsApp/2.23' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<meta property="og:title" content="Promo da Ana">');
    expect(res.body).toContain('property="og:description"');
    expect(res.body).not.toContain('chat.whatsapp.com');
    expect(res.body).not.toContain('http-equiv="refresh"');
  });

  it('apex: 302 para landingUrl; sem landingUrl → 404 da marca', async () => {
    next = { kind: 'apex', landingUrl: 'https://exemplo.com/' };
    const res = await get('/', 'copysync.com.br');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://exemplo.com/');
    next = { kind: 'apex', landingUrl: null };
    const none = await get('/', 'copysync.com.br');
    expect(none.statusCode).toBe(404);
    expect(none.body).toContain('Link não encontrado');
  });

  it('erro do use case vira 503 HTML', async () => {
    resolver.execute.mockRejectedValueOnce(new Error('db down'));
    const res = await get('/');
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('Link indisponível');
  });

  it('Host com porta e maiúsculas é normalizado', async () => {
    next = { kind: 'paused', title: 'P' };
    expect((await get('/', 'PROMO.CopySync.com.br:443')).statusCode).toBe(200);
  });

  it('www.slug.dominio: 404 da marca sem chamar o use case', async () => {
    const res = await get('/', `www.${HOST}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Link não encontrado');
    expect(resolver.execute).not.toHaveBeenCalled();
  });
});

describe('isolamento host público × host da API', () => {
  it('host da API não é interceptado: rotas normais respondem e GET / é o 404 padrão', async () => {
    expect((await get('/health', 'api.copysync.app')).json()).toEqual({ status: 'ok' });
    expect((await get('/api/me', 'api.copysync.app')).json()).toEqual({ me: true });
    const root = await get('/', 'api.copysync.app');
    expect(root.statusCode).toBe(404);
    expect(root.headers['content-type']).toContain('application/json');
    expect((await get('/.well-known/link-rotation', 'api.copysync.app')).headers['content-type']).toContain('application/json');
    expect(resolver.execute).not.toHaveBeenCalled();
  });

  it.each(['/health', '/api/me', '/docs', '/qualquer'])('host público não expõe %s', async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).not.toContain('"status"');
  });

  it('host público recusa método diferente de GET/HEAD', async () => {
    const res = await app.inject({ method: 'POST', url: '/', headers: { host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(resolver.execute).not.toHaveBeenCalled();
  });

  it('domínio pai da plataforma cadastrado: host da API e do painel nunca são interceptados', async () => {
    await app.close();
    load = vi.fn<Load>(async () => [{ ...DOMAIN, hostname: 'copysync.app' }]);
    app = Fastify();
    registerPublicLinkRoutes(app, { domains: new ActiveLinkDomainCache(load), resolver, probeSecret: SECRET });
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();
    for (const host of ['api.copysync.app', 'app.copysync.app', 'API.copysync.app:443']) {
      expect((await get('/health', host)).json()).toEqual({ status: 'ok' });
    }
    expect(load).not.toHaveBeenCalled();
    expect((await get('/health', 'promo.copysync.app')).statusCode).toBe(404);
  });

  it('falha ao carregar domínios: não intercepta (API segue normal)', async () => {
    await app.close();
    load = vi.fn<Load>(async () => { throw new Error('db down'); });
    app = Fastify();
    registerPublicLinkRoutes(app, { domains: new ActiveLinkDomainCache(load), resolver, probeSecret: SECRET });
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();
    expect((await get('/health')).json()).toEqual({ status: 'ok' });
  });
});

describe('identidade da página', () => {
  afterEach(() => configurePublicPageBranding({ panelUrl: null, mediaUrl: null }));

  it('favicon e logo do painel, foto do grupo só do armazenamento de mídia, CSP com as duas origens', async () => {
    configurePublicPageBranding({ panelUrl: 'https://app.exemplo.com/login', mediaUrl: 'https://media.exemplo.com/bucket' });
    next = { kind: 'redirect', inviteUrl: INVITE, groupName: 'Ofertas VIP', groupAvatarUrl: 'https://media.exemplo.com/media/g.jpg', title: 'Promo' };
    const res = await get('/');
    expect(res.body).toContain('<img class="av" src="https://media.exemplo.com/media/g.jpg"');
    expect(res.body).toContain('<link rel="icon" type="image/png" sizes="32x32" href="https://app.exemplo.com/assets/brand/favicon-32.png">');
    expect(res.body).toContain('<footer><img src="https://app.exemplo.com/assets/brand/icon-192.png"');
    expect(res.body).toContain('<meta property="og:image" content="https://media.exemplo.com/media/g.jpg">');
    expect(res.headers['content-security-policy']).toContain('img-src https://app.exemplo.com https://media.exemplo.com;');
  });

  it('foto de outra origem é ignorada (inicial no lugar) e a prévia usa o ícone da marca', async () => {
    configurePublicPageBranding({ panelUrl: 'https://app.exemplo.com', mediaUrl: 'https://media.exemplo.com' });
    next = { kind: 'redirect', inviteUrl: INVITE, groupName: 'ofertas', groupAvatarUrl: 'https://evil.test/x.jpg', title: 'Promo' };
    const res = await get('/');
    expect(res.body).not.toContain('evil.test');
    expect(res.body).toContain('<span class="av av-i" aria-hidden="true">O</span>');
    expect(res.body).toContain('content="https://app.exemplo.com/assets/brand/icon-512.png"');
  });
});

describe('probe /.well-known/link-rotation', () => {
  const probeHost = `probe-0a1b2c3d.${DOMAIN.hostname}`;
  const url = (token: string) => `/.well-known/link-rotation?token=${encodeURIComponent(token)}`;

  it('token válido do domínio → 204', async () => {
    const token = createProbeToken({ domainId: DOMAIN.id, hostname: DOMAIN.hostname }, NOW, SECRET);
    const res = await get(url(token), probeHost);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['outro domínio', () => createProbeToken({ domainId: 'outro', hostname: DOMAIN.hostname }, NOW, SECRET)],
    ['outro segredo', () => createProbeToken({ domainId: DOMAIN.id, hostname: DOMAIN.hostname }, NOW, 'x'.repeat(32))],
    ['lixo', () => 'abc'],
  ])('token inválido (%s) → 404', async (_n, make) => {
    expect((await get(url(make()), probeHost)).statusCode).toBe(404);
  });

  it('sem token → 404', async () => {
    expect((await get('/.well-known/link-rotation', probeHost)).statusCode).toBe(404);
  });
});

describe('rate limit', () => {
  it('preset publicLink é 60/min e vale nas rotas públicas', async () => {
    expect(rateLimitPresets.publicLink).toEqual({ max: 60, timeWindow: '1 minute' });
    next = { kind: 'paused', title: 'P' };
    for (let i = 0; i < 60; i++) expect((await get('/')).statusCode).toBe(200);
    const limited = await get('/');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['content-type']).toMatch(/text\/html/);
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(limited.body).toContain('Muitos acessos');
  });
});

describe('cache de domínios', () => {
  it('uma consulta por TTL entre hosts da API e públicos', async () => {
    await get('/health', 'api.copysync.app');
    await get('/health', 'api.copysync.app');
    await get('/', HOST);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('página de ofertas no mesmo namespace (pageRenderers)', () => {
  const CSS = 'body{color:#111}';
  let pageApp: FastifyInstance;
  let render: ReturnType<typeof vi.fn<PublicPageRenderer['render']>>;

  const page = (over: Partial<NonNullable<Awaited<ReturnType<PublicPageRenderer['render']>>>> = {}) => ({
    status: 200,
    html: `<!doctype html><html><head><style>${CSS}</style></head><body>Vitrine da Ana</body></html>`,
    styleHash: `sha256-${createHash('sha256').update(CSS).digest('base64')}`,
    cacheable: true,
    ...over,
  });

  beforeEach(async () => {
    render = vi.fn<PublicPageRenderer['render']>(async () => page());
    pageApp = Fastify();
    registerPublicLinkRoutes(pageApp, {
      domains: new ActiveLinkDomainCache(load),
      resolver,
      probeSecret: null,
      pageRenderers: { [PublicSlugKind.STOREFRONT]: { render } },
      now: () => NOW,
    });
    await pageApp.ready();
  });

  afterEach(async () => { await pageApp.close(); });

  const open = (host = HOST) =>
    pageApp.inject({ method: 'GET', url: '/', headers: { host, 'user-agent': 'Mozilla/5.0' } });

  it('nome sem rodízio → HTML da página com CSP do hash do <style> e cache de 60 s', async () => {
    const res = await open();
    expect(render).toHaveBeenCalledWith({ domainId: DOMAIN.id, slug: 'promo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Vitrine da Ana');
    expect(res.headers['content-security-policy']).toContain(`style-src '${page().styleHash}'`);
    expect(res.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('página não cacheável (em breve/pausada/503) → no-store e noindex', async () => {
    render.mockResolvedValueOnce(page({ cacheable: false }));
    const soon = await open();
    expect(soon.headers['cache-control']).toBe('no-store');
    expect(soon.headers['x-robots-tag']).toBe('noindex, nofollow');
    render.mockResolvedValueOnce(page({ status: 503, cacheable: true }));
    const down = await open();
    expect(down.statusCode).toBe(503);
    expect(down.headers['cache-control']).toBe('no-store');
  });

  it('hash fora do formato não vira header (503 da marca)', async () => {
    render.mockResolvedValueOnce(page({ styleHash: "x'; script-src *" }));
    const res = await open();
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-security-policy']).toBe(publicPageCsp());
  });

  it('nome é rodízio → resposta do rodízio, sem chamar a página', async () => {
    next = { kind: 'paused', title: 'Promo' };
    const res = await open();
    expect(res.body).toContain('Link em pausa');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(render).not.toHaveBeenCalled();
  });

  it('apex segue a landing sem chamar a página', async () => {
    next = { kind: 'apex', landingUrl: 'https://exemplo.com/' };
    const res = await open('copysync.com.br');
    expect(res.statusCode).toBe(302);
    expect(render).not.toHaveBeenCalled();
  });

  it('renderer sem página (null) → 404 da marca', async () => {
    render.mockResolvedValueOnce(null);
    const res = await open();
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Link não encontrado');
  });

  it('erro do renderer → 503 HTML', async () => {
    render.mockRejectedValueOnce(new Error('db down'));
    expect((await open()).statusCode).toBe(503);
  });

  it('sem renderer registrado → 404 como hoje', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });
});
