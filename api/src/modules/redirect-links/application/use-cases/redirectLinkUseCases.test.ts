import { describe, expect, it, vi } from 'vitest';
import type { IRedirectLinkRepository, RedirectLinkData } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectLink, RedirectSide } from '../../domain/entities/RedirectLink';
import { RedirectLinkNotFoundError } from '../../../../shared/errors/internal/RedirectLinkErrors';
import { CreateRedirectLinkUseCase } from './CreateRedirectLinkUseCase';
import { UpdateRedirectLinkUseCase } from './UpdateRedirectLinkUseCase';
import { ResolveRedirectLinkUseCase } from './ResolveRedirectLinkUseCase';

const PLATFORM = ['app.copysync.app', 'api.copysync.app'];

class FakeRepo implements IRedirectLinkRepository {
  rows = new Map<string, RedirectLink>();
  hits: Array<[string, RedirectSide]> = [];
  private seq = 0;
  async list() { return [...this.rows.values()]; }
  async findById(id: string) { return this.rows.get(id) ?? null; }
  async findBySlug(slug: string) { return [...this.rows.values()].find((r) => r.slug === slug) ?? null; }
  async findActiveBySlug(slug: string) { const r = await this.findBySlug(slug); return r?.isActive ? r : null; }
  async create(data: RedirectLinkData) {
    const now = new Date();
    const row: RedirectLink = { ...data, id: `id${++this.seq}`, hitsA: 0, hitsB: 0, createdAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, data: RedirectLinkData) {
    const row = this.rows.get(id);
    if (!row) throw new RedirectLinkNotFoundError();
    const next = { ...row, ...data };
    this.rows.set(id, next);
    return next;
  }
  async delete(id: string) { this.rows.delete(id); }
  async incrementHit(id: string, side: RedirectSide) { this.hits.push([id, side]); }
}

const setup = () => {
  const repo = new FakeRepo();
  return { repo, create: new CreateRedirectLinkUseCase(repo, PLATFORM), update: new UpdateRedirectLinkUseCase(repo, PLATFORM) };
};

describe('CreateRedirectLinkUseCase', () => {
  it('normaliza slug; sem B força 100% A', async () => {
    const { create } = setup();
    const link = await create.execute({ slug: ' Suporte ', urlA: 'https://wa.me/55', percentA: 10 });
    expect(link).toMatchObject({ slug: 'suporte', urlB: null, percentA: 100, isActive: true, note: null });
  });

  it('com B sem percentual usa 50', async () => {
    const { create } = setup();
    expect(await create.execute({ slug: 'ab', urlA: 'https://a.com', urlB: 'https://b.com' })).toMatchObject({ percentA: 50 });
  });

  it('erros com campo: slug, urlA, urlB, loop e slug repetido', async () => {
    const { create } = setup();
    await expect(create.execute({ slug: 'a_b', urlA: 'https://a.com' })).rejects.toMatchObject({ code: 'REDIRECT_LINK_INVALID', meta: { field: 'slug' } });
    await expect(create.execute({ slug: 'x', urlA: 'http://a.com' })).rejects.toMatchObject({ meta: { field: 'urlA', reason: 'NOT_HTTPS' } });
    await expect(create.execute({ slug: 'x', urlA: 'https://a.com', urlB: 'https://u:p@b.com' })).rejects.toMatchObject({ meta: { field: 'urlB', reason: 'CREDENTIALS' } });
    await expect(create.execute({ slug: 'x', urlA: 'https://app.copysync.app/redirect/x' })).rejects.toMatchObject({ meta: { reason: 'LOOP' } });
    await create.execute({ slug: 'x', urlA: 'https://a.com' });
    await expect(create.execute({ slug: 'X', urlA: 'https://a.com' })).rejects.toMatchObject({ code: 'REDIRECT_LINK_SLUG_TAKEN', statusCode: 409 });
  });
});

describe('UpdateRedirectLinkUseCase', () => {
  it('troca o slug (o antigo some) e preserva o resto', async () => {
    const { repo, create, update } = setup();
    const link = await create.execute({ slug: 'loja', urlA: 'https://a.com', note: 'n' });
    const out = await update.execute({ id: link.id, slug: 'loja-v2' });
    expect(out).toMatchObject({ slug: 'loja-v2', urlA: 'https://a.com/', note: 'n' });
    expect(await repo.findBySlug('loja')).toBeNull();
  });

  it('remover B volta a 100%; slug de outro link = 409; inexistente = 404', async () => {
    const { create, update } = setup();
    const a = await create.execute({ slug: 'a', urlA: 'https://a.com', urlB: 'https://b.com', percentA: 20 });
    await create.execute({ slug: 'b', urlA: 'https://a.com' });
    expect(await update.execute({ id: a.id, percentA: 35 })).toMatchObject({ percentA: 35 });
    expect(await update.execute({ id: a.id, urlB: null })).toMatchObject({ urlB: null, percentA: 100 });
    await expect(update.execute({ id: a.id, slug: 'b' })).rejects.toMatchObject({ code: 'REDIRECT_LINK_SLUG_TAKEN' });
    await expect(update.execute({ id: 'nope', isActive: false })).rejects.toMatchObject({ code: 'REDIRECT_LINK_NOT_FOUND', statusCode: 404 });
  });
});

describe('ResolveRedirectLinkUseCase', () => {
  it('sorteia com rng injetado e conta o lado escolhido', async () => {
    const { repo, create } = setup();
    const link = await create.execute({ slug: 'ab', urlA: 'https://a.com', urlB: 'https://b.com', percentA: 50 });
    const toA = new ResolveRedirectLinkUseCase(repo, { rng: () => 0.1 });
    const toB = new ResolveRedirectLinkUseCase(repo, { rng: () => 0.9 });
    expect(await toA.execute('AB')).toEqual({ url: 'https://a.com/', side: 'A' });
    expect(await toB.execute('ab')).toEqual({ url: 'https://b.com/', side: 'B' });
    expect(repo.hits).toEqual([[link.id, 'A'], [link.id, 'B']]);
  });

  it('inativo, inexistente ou slug inválido = null sem contar', async () => {
    const { repo, create } = setup();
    await create.execute({ slug: 'off', urlA: 'https://a.com', isActive: false });
    const uc = new ResolveRedirectLinkUseCase(repo);
    expect(await uc.execute('off')).toBeNull();
    expect(await uc.execute('nada')).toBeNull();
    expect(await uc.execute('../x')).toBeNull();
    expect(repo.hits).toEqual([]);
  });

  it('destino não https gravado por fora = null (defesa de saída)', async () => {
    const { repo } = setup();
    await repo.create({ slug: 'bad', urlA: 'javascript:alert(1)', urlB: null, percentA: 100, isActive: true, note: null });
    expect(await new ResolveRedirectLinkUseCase(repo).execute('bad')).toBeNull();
  });

  it('falha do contador não derruba a resposta', async () => {
    const { repo, create } = setup();
    await create.execute({ slug: 's', urlA: 'https://a.com' });
    vi.spyOn(repo, 'incrementHit').mockRejectedValue(new Error('db'));
    const onCountError = vi.fn();
    const out = await new ResolveRedirectLinkUseCase(repo, { onCountError }).execute('s');
    expect(out?.url).toBe('https://a.com/');
    await new Promise((r) => setTimeout(r, 0));
    expect(onCountError).toHaveBeenCalledOnce();
  });
});
