import { beforeEach, describe, expect, it } from 'vitest';
import type { RecordLinkClickInput } from '../../domain/contracts/ILinkClickRepository';
import type { ILinkRotationPublicStore } from '../../domain/contracts/ILinkRotationPublicStore';
import type { PublicLinkRotation } from '../../domain/contracts/ILinkRotationRepository';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import { LinkRotationStatus, LinkRotationStrategy } from '../../domain/enums/LinkRotationEnums';
import { hashClickIp } from '../../domain/services/hashClickIp';
import { CODE, InMemoryLinkRotationRepository, NOW, SESSION, makeDomain } from './linkRotationTestFakes';
import { ResolvePublicLinkUseCase, type ResolvePublicLinkDeps } from './ResolvePublicLinkUseCase';

const SALT = 'salt-de-teste';
const HOST = 'promo.copysync.com.br';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0';
const CODE_B = 'BbBbBbBbBbBbBbBbBbBbBb';

/** Repositório em memória + versão funcional de findPublicByHost/incrementClick (o fake base devolve null). */
class PublicRepo extends InMemoryLinkRotationRepository {
  tenantActive = true;
  failIncrement = false;
  constructor(private readonly domain: LinkDomain) { super(); }
  async publicFind(hostname: string, slug: string): Promise<PublicLinkRotation | null> {
    if (hostname !== this.domain.hostname) return null;
    const r = this.rotations.find((x) => x.domainId === this.domain.id && x.slug === slug);
    if (!r) return null;
    const rotation = { ...r, groups: this.groups.filter((g) => g.rotationId === r.id).map((g) => ({ ...g })) };
    return { rotation, domain: this.domain, tenantActive: this.tenantActive };
  }
  async countClick(rotationId: string, groupId: string, at: Date): Promise<void> {
    if (this.failIncrement) throw new Error('db down');
    const g = this.groups.find((x) => x.id === groupId && x.rotationId === rotationId)!;
    g.clickCount++; g.clicksSinceSync++; g.lastClickAt = at;
    const r = this.rotations.find((x) => x.id === rotationId)!;
    r.clickCount++; r.lastClickAt = at;
  }
}

class FakeClicks {
  items: RecordLinkClickInput[] = [];
  async record(input: RecordLinkClickInput) { this.items.push(input); }
}

class FakeStore implements ILinkRotationPublicStore {
  marks: Date[] = [];
  constructor(private readonly repo: PublicRepo, private readonly clicks: FakeClicks) {}
  async hasRecentClick(tenantId: string, rotationId: string, ipHash: string, since: Date) {
    return this.clicks.items.some((c) => c.tenantId === tenantId && c.rotationId === rotationId && c.ipHash === ipHash && c.createdAt! >= since);
  }
  async markAllFullNotified(tenantId: string, rotationId: string, at: Date, staleBefore: Date) {
    const r = this.repo.rotations.find((x) => x.id === rotationId && x.tenantId === tenantId)!;
    if (r.allFullNotifiedAt && r.allFullNotifiedAt >= staleBefore) return false;
    r.allFullNotifiedAt = at;
    this.marks.push(at);
    return true;
  }
  async findLabels(_t: string, sessionId: string, conversationId: string | null) {
    return { sessionName: sessionId === SESSION ? 'Principal' : null, groupName: conversationId ? `Grupo ${conversationId}` : null };
  }
}

let domain: LinkDomain;
let repo: PublicRepo;
let clicks: FakeClicks;
let store: FakeStore;
let warnings: string[];
let deps: ResolvePublicLinkDeps;
const useCase = () => new ResolvePublicLinkUseCase(deps);
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const resolve = (over: { hostname?: string; ip?: string; userAgent?: string; now?: Date } = {}) =>
  useCase().execute({ hostname: HOST, ip: '200.1.1.1', userAgent: BROWSER, now: NOW, ...over });

beforeEach(() => {
  domain = makeDomain();
  repo = new PublicRepo(domain);
  clicks = new FakeClicks();
  store = new FakeStore(repo, clicks);
  warnings = [];
  deps = {
    domains: { listActive: async () => [domain] },
    rotations: { findPublicByHost: (h, s) => repo.publicFind(h, s), incrementClick: (r, g, t) => repo.countClick(r, g, t) },
    clicks, store, clickSalt: SALT, rng: () => 0,
    warn: (_c, m) => { warnings.push(m); },
  };
});

function seedRotation(over: Parameters<PublicRepo['seed']>[0] = {}) {
  return repo.seed({ slug: 'promo', ...over });
}

describe('ResolvePublicLinkUseCase', () => {
  it('apex com e sem landingUrl', async () => {
    expect(await resolve({ hostname: 'copysync.com.br' })).toEqual({ kind: 'apex', landingUrl: null });
    domain.landingUrl = 'https://site.exemplo';
    expect(await resolve({ hostname: 'CopySync.com.br.:443' })).toEqual({ kind: 'apex', landingUrl: 'https://site.exemplo' });
  });

  it('www.slug.dom, slug inexistente e domínio desconhecido → not_found', async () => {
    seedRotation();
    expect(await resolve({ hostname: `www.${HOST}` })).toEqual({ kind: 'not_found' });
    expect(await resolve({ hostname: 'outro.copysync.com.br' })).toEqual({ kind: 'not_found' });
    expect(await resolve({ hostname: 'promo.outro.com' })).toEqual({ kind: 'not_found' });
  });

  it('redirect normaliza Host, conta o clique e grava ipHash', async () => {
    const r = seedRotation();
    const g = repo.seedGroup(r.id);
    const out = await resolve({ hostname: 'PROMO.copysync.com.br:8080' });
    expect(out).toEqual({ kind: 'redirect', inviteUrl: `https://chat.whatsapp.com/${CODE}`, groupName: `Grupo ${g.conversationId}`, title: 'Principal' });
    expect(repo.groups[0]!.clickCount).toBe(1);
    expect(clicks.items).toEqual([{ tenantId: r.tenantId, rotationId: r.id, groupId: g.id, ipHash: hashClickIp('200.1.1.1', NOW, SALT), userAgentClass: 'browser', createdAt: NOW }]);
  });

  it('title da rotação tem prioridade', async () => {
    const r = seedRotation({ title: 'Ofertas VIP' });
    repo.seedGroup(r.id);
    expect(await resolve()).toMatchObject({ kind: 'redirect', title: 'Ofertas VIP' });
  });

  it('bot não conta e não recebe invite; webview conta', async () => {
    const r = seedRotation();
    repo.seedGroup(r.id);
    expect(await resolve({ userAgent: 'WhatsApp/2.23.20 A' })).toEqual({ kind: 'bot_preview', title: 'Principal' });
    expect(await resolve({ userAgent: '' })).toEqual({ kind: 'bot_preview', title: 'Principal' });
    expect(clicks.items).toHaveLength(0);
    expect(await resolve({ userAgent: INSTAGRAM })).toMatchObject({ kind: 'redirect' });
    expect(clicks.items.map((c) => c.userAgentClass)).toEqual(['webview']);
  });

  it('teto: A capacity 1 e memberCount 0 → 1º A, 2º B', async () => {
    const r = seedRotation({ strategy: LinkRotationStrategy.SEQUENTIAL });
    repo.seedGroup(r.id, { position: 0, capacity: 1, memberCount: 0 });
    repo.seedGroup(r.id, { position: 1, inviteCode: CODE_B });
    expect(await resolve({ ip: '1.1.1.1' })).toMatchObject({ inviteUrl: `https://chat.whatsapp.com/${CODE}` });
    expect(repo.groups[0]!.clicksSinceSync).toBe(1);
    expect(await resolve({ ip: '2.2.2.2' })).toMatchObject({ inviteUrl: `https://chat.whatsapp.com/${CODE_B}` });
  });

  it('nenhum elegível → all_full; allFullNotifiedAt gravado só 1×/h', async () => {
    const r = seedRotation();
    repo.seedGroup(r.id, { capacity: 1, memberCount: 1 });
    expect(await resolve()).toEqual({ kind: 'all_full', title: 'Principal' });
    await resolve({ now: at(30) });
    expect(store.marks).toEqual([NOW]);
    await resolve({ now: at(61) });
    expect(store.marks).toEqual([NOW, at(61)]);
    expect(clicks.items).toHaveLength(0);
  });

  it('tenant inativo ou recurso sem salt → unavailable', async () => {
    const r = seedRotation();
    repo.seedGroup(r.id);
    repo.tenantActive = false;
    expect(await resolve()).toEqual({ kind: 'unavailable' });
    repo.tenantActive = true;
    deps.clickSalt = null;
    expect(await resolve()).toEqual({ kind: 'unavailable' });
    expect(clicks.items).toHaveLength(0);
  });

  it('pausado (manual ou por plano) → paused', async () => {
    const r = seedRotation({ status: LinkRotationStatus.PAUSED });
    repo.seedGroup(r.id);
    expect(await resolve()).toEqual({ kind: 'paused', title: 'Principal' });
    repo.rotations[0]!.status = LinkRotationStatus.PAUSED_BY_PLAN;
    expect(await resolve()).toEqual({ kind: 'paused', title: 'Principal' });
    expect(clicks.items).toHaveLength(0);
  });

  it('erro ao contar não bloqueia o redirect', async () => {
    const r = seedRotation();
    repo.seedGroup(r.id);
    repo.failIncrement = true;
    expect(await resolve()).toMatchObject({ kind: 'redirect', inviteUrl: `https://chat.whatsapp.com/${CODE}` });
    expect(warnings).toEqual(['link click not counted']);
  });

  it('dedupe: mesmo IP em 10 min não conta de novo, mas recebe destino', async () => {
    const r = seedRotation();
    repo.seedGroup(r.id);
    await resolve();
    expect(await resolve({ now: at(9) })).toMatchObject({ kind: 'redirect' });
    expect(clicks.items).toHaveLength(1);
    expect(repo.rotations[0]!.clickCount).toBe(1);
    await resolve({ now: at(11) });
    await resolve({ ip: '9.9.9.9', now: at(11) });
    expect(clicks.items).toHaveLength(3);
  });
});
