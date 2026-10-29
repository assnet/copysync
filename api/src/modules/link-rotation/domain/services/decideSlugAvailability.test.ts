import { describe, expect, it } from 'vitest';
import { PublicSlugKind } from '../enums/LinkRotationEnums';
import { type DecideSlugInput, decideSlugAvailability, NO_SLUG_FACTS, type SlugFacts } from './decideSlugAvailability';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const LATER = new Date(NOW.getTime() + 86_400_000);
const EARLIER = new Date(NOW.getTime() - 1);

const decide = (raw: string, facts: Partial<SlugFacts> = {}, over: Partial<DecideSlugInput> = {}) =>
  decideSlugAvailability({
    raw, tenantId: 't1', reservedNames: ['loja'], premiumNames: ['vip'], facts: { ...NO_SLUG_FACTS, ...facts }, now: NOW, ...over,
  });

const claimOf = (tenantId: string) => ({ tenantId, kind: PublicSlugKind.STOREFRONT, ownerId: 'sf-1' });

describe('decideSlugAvailability', () => {
  it('formato inválido vem antes de tudo', () => {
    expect(decide('ab', { claim: claimOf('t2') })).toEqual({ status: 'INVALID', slug: 'ab' });
  });

  it('reservado padrão e do domínio → RESERVED (NAME), mesmo com claim', () => {
    expect(decide('admin')).toEqual({ status: 'RESERVED', slug: 'admin', reservedReason: 'NAME' });
    expect(decide('Loja', { claim: claimOf('t1') })).toMatchObject({ status: 'RESERVED', reservedReason: 'NAME' });
  });

  it('claim do próprio tenant → OWNED com dono; de outro → TAKEN', () => {
    expect(decide('promo', { claim: claimOf('t1') })).toEqual({
      status: 'OWNED', slug: 'promo', owner: { kind: PublicSlugKind.STOREFRONT, ownerId: 'sf-1' },
    });
    expect(decide('promo', { claim: claimOf('t2') })).toEqual({ status: 'TAKEN', slug: 'promo' });
  });

  it('claim vence reserva e premium', () => {
    const facts = { claim: claimOf('t2'), reservation: { tenantId: 't3', expiresAt: LATER } };
    expect(decide('vip', facts).status).toBe('TAKEN');
  });

  it('rodízio sem claim (janela de deploy) → TAKEN', () => {
    expect(decide('promo', { unclaimedRotation: true }).status).toBe('TAKEN');
  });

  it('reserva vigente de outro tenant → RESERVED (RECENT_RELEASE); própria ou vencida não bloqueia', () => {
    expect(decide('promo', { reservation: { tenantId: 't2', expiresAt: LATER } }))
      .toEqual({ status: 'RESERVED', slug: 'promo', reservedReason: 'RECENT_RELEASE' });
    expect(decide('promo', { reservation: { tenantId: 't1', expiresAt: LATER } }).status).toBe('AVAILABLE');
    expect(decide('promo', { reservation: { tenantId: 't2', expiresAt: EARLIER } }).status).toBe('AVAILABLE');
  });

  it('reserva vem antes de premium', () => {
    expect(decide('vip', { reservation: { tenantId: 't2', expiresAt: LATER } }).status).toBe('RESERVED');
  });

  it('premium sem grant do tenant → PREMIUM; grant vigente libera', () => {
    expect(decide('VIP')).toEqual({ status: 'PREMIUM', slug: 'vip' });
    expect(decide('vip', { grant: { tenantId: 't2', expiresAt: null } }).status).toBe('PREMIUM');
    expect(decide('vip', { grant: { tenantId: 't1', expiresAt: EARLIER } }).status).toBe('PREMIUM');
    expect(decide('vip', { grant: { tenantId: 't1', expiresAt: null } }).status).toBe('AVAILABLE');
    expect(decide('vip', { grant: { tenantId: 't1', expiresAt: LATER } }).status).toBe('AVAILABLE');
  });

  it('nome comum sem fatos → AVAILABLE normalizado', () => {
    expect(decide(' Promo De Mãe ')).toEqual({ status: 'AVAILABLE', slug: 'promo-de-mae' });
  });
});
