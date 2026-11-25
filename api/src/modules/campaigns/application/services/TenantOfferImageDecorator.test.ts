import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/logger/logger', () => ({ logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn() }) } }));

import { TenantOfferImageDecorator } from './TenantOfferImageDecorator';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';

const PHOTO = Buffer.from('foto');
const LOGO = Buffer.from('logo');
const MARKED = Buffer.from('marcada');

const record = (over: Partial<OfferWatermark> = {}): OfferWatermark => ({
  id: 'w1', tenantId: 't1', kind: 'IMAGE', imageKey: 'offer-watermark-x.png', text: 'Minha Loja', enabled: true,
  position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80, createdAt: new Date(), updatedAt: new Date(), ...over,
});

let plan: boolean | null;
let rec: OfferWatermark | null;
const getBoolean = vi.fn(async () => plan);
const findByTenant = vi.fn(async () => rec);
const read = vi.fn(async (_k: string): Promise<Buffer | null> => LOGO);
const compose = vi.fn(async (_p: Buffer, _m: unknown, _l: unknown) => MARKED);
const decorator = () => new TenantOfferImageDecorator({
  entitlements: { getBoolean }, watermarks: { findByTenant }, logos: { read }, compositor: { compose },
});

beforeEach(() => {
  plan = true;
  rec = record();
  vi.clearAllMocks();
  read.mockResolvedValue(LOGO);
  compose.mockResolvedValue(MARKED);
});

describe('TenantOfferImageDecorator', () => {
  it('logo: lê pela chave e compõe com posição, tamanho e opacidade do registro', async () => {
    await expect(decorator().decorate('t1', PHOTO)).resolves.toBe(MARKED);
    expect(getBoolean).toHaveBeenCalledWith('t1', 'offer_watermark_enabled');
    expect(findByTenant).toHaveBeenCalledWith('t1');
    expect(read).toHaveBeenCalledWith('offer-watermark-x.png');
    expect(compose).toHaveBeenCalledWith(PHOTO, { kind: 'IMAGE', logo: LOGO }, { position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80 });
    await expect(decorator().applies('t1')).resolves.toBe(true);
  });

  it('IMAGE com texto guardado não desenha o texto', async () => {
    await decorator().decorate('t1', PHOTO);
    expect(compose.mock.calls[0]![1]).toEqual({ kind: 'IMAGE', logo: LOGO });
  });

  it('TEXT com logo guardado não lê nem desenha o logo', async () => {
    rec = record({ kind: 'TEXT' });
    await expect(decorator().decorate('t1', PHOTO)).resolves.toBe(MARKED);
    expect(read).not.toHaveBeenCalled();
    expect(compose.mock.calls[0]![1]).toEqual({ kind: 'TEXT', text: 'Minha Loja' });
  });

  it.each([
    ['sem plano (ausente)', () => { plan = null; }],
    ['plano false', () => { plan = false; }],
    ['sem registro', () => { rec = null; }],
    ['desligada', () => { rec = record({ enabled: false }); }],
    ['IMAGE sem logo', () => { rec = record({ imageKey: null }); }],
    ['TEXT sem texto', () => { rec = record({ kind: 'TEXT', text: null }); }],
  ])('%s: foto intacta (mesmos bytes) e applies = false', async (_n, arrange) => {
    arrange();
    await expect(decorator().decorate('t1', PHOTO)).resolves.toBe(PHOTO);
    await expect(decorator().applies('t1')).resolves.toBe(false);
    expect(compose).not.toHaveBeenCalled();
  });

  it('sem plano não lê o registro', async () => {
    plan = false;
    await decorator().applies('t1');
    expect(findByTenant).not.toHaveBeenCalled();
  });

  it('logo sumido do storage: foto intacta e loga', async () => {
    read.mockResolvedValue(null);
    await expect(decorator().decorate('t1', PHOTO)).resolves.toBe(PHOTO);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    ['storage fora', () => read.mockRejectedValue(new Error('s3 down'))],
    ['logo corrompido', () => compose.mockRejectedValue(new Error('bad png'))],
    ['banco fora', () => findByTenant.mockRejectedValueOnce(new Error('db'))],
  ])('%s: foto intacta, loga warn, nunca lança', async (_n, arrange) => {
    arrange();
    await expect(decorator().decorate('t1', PHOTO)).resolves.toBe(PHOTO);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), 'offer watermark failed, sending clean photo');
  });

  it('erro na leitura do plano: applies = false, nunca lança', async () => {
    getBoolean.mockRejectedValueOnce(new Error('db'));
    await expect(decorator().applies('t1')).resolves.toBe(false);
  });

  it('lê plano e registro a cada chamada (sem cache)', async () => {
    const d = decorator();
    await d.decorate('t1', PHOTO);
    await d.decorate('t1', PHOTO);
    expect(getBoolean).toHaveBeenCalledTimes(2);
    expect(findByTenant).toHaveBeenCalledTimes(2);
  });
});
