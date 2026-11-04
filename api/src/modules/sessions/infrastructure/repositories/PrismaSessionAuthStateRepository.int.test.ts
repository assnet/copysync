import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaSessionAuthStateRepository } from './PrismaSessionAuthStateRepository';

/** CAS por versão no auth state (LEASE-06): versão errada não grava nenhuma chave. */
const repo = new PrismaSessionAuthStateRepository();
let tenantId = '';
let sessionId = '';

const batch = (upserts: Record<string, unknown>, extra: { deletes?: string[]; expectedVersion?: number | null } = {}) => ({
  sessionId,
  tenantId,
  provider: 'baileys',
  upserts,
  deletes: extra.deletes ?? [],
  ...('expectedVersion' in extra ? { expectedVersion: extra.expectedVersion } : {}),
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-auth-cas-${Date.now()}` } })).id;
});
beforeEach(async () => {
  if (sessionId) await repo.deleteBySessionId(sessionId);
  sessionId = (await prisma.session.create({ data: { tenantId, name: 'int-cas' } })).id;
});
afterAll(async () => {
  await prisma.sessionAuthState.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('findAllKeysVersioned', () => {
  it('sem linha-mãe → chaves vazias e version null; depois devolve chaves e versão gravadas', async () => {
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: {}, version: null });
    const w = await repo.writeKeys(batch({ a: 1, b: { x: 'y' } }, { expectedVersion: null }));
    expect(w).toEqual({ ok: true, version: 0 });
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: { a: 1, b: { x: 'y' } }, version: 0 });
  });
});

describe('writeKeys com expectedVersion', () => {
  it('versão certa grava e devolve version+1', async () => {
    await repo.writeKeys(batch({ a: 1 }, { expectedVersion: null }));
    expect(await repo.writeKeys(batch({ a: 2, c: 3 }, { expectedVersion: 0 }))).toEqual({ ok: true, version: 1 });
    expect(await repo.writeKeys(batch({}, { deletes: ['c'], expectedVersion: 1 }))).toEqual({ ok: true, version: 2 });
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: { a: 2 }, version: 2 });
  });

  it('versão errada → VERSION_CONFLICT sem tocar nenhuma chave nem a versão', async () => {
    await repo.writeKeys(batch({ a: 1, b: 1 }, { expectedVersion: null }));
    expect(await repo.writeKeys(batch({ a: 99, z: 1 }, { deletes: ['b'], expectedVersion: 7 }))).toEqual({
      ok: false,
      reason: 'VERSION_CONFLICT',
    });
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: { a: 1, b: 1 }, version: 0 });
  });

  it('expectedVersion null com linha existente → conflito; número sem linha → conflito', async () => {
    expect(await repo.writeKeys(batch({ a: 1 }, { expectedVersion: 0 }))).toEqual({ ok: false, reason: 'VERSION_CONFLICT' });
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: {}, version: null });
    await repo.writeKeys(batch({ a: 1 }, { expectedVersion: null }));
    expect(await repo.writeKeys(batch({ a: 2 }, { expectedVersion: null }))).toEqual({ ok: false, reason: 'VERSION_CONFLICT' });
    expect((await repo.findAllKeysVersioned(sessionId)).keys).toEqual({ a: 1 });
  });

  it('clearCredentials faz o handle antigo conflitar', async () => {
    await repo.writeKeys(batch({ creds: 'x' }, { expectedVersion: null }));
    const old = (await repo.findAllKeysVersioned(sessionId)).version;
    await repo.clearCredentials(sessionId);
    expect(await repo.writeKeys(batch({ creds: 'velho' }, { expectedVersion: old }))).toEqual({ ok: false, reason: 'VERSION_CONFLICT' });
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: {}, version: 1 });
  });

  it('dois handles com a mesma versão em paralelo: só um grava', async () => {
    await repo.writeKeys(batch({ a: 0 }, { expectedVersion: null }));
    const results = await Promise.all([
      repo.writeKeys(batch({ a: 'h1' }, { expectedVersion: 0 })),
      repo.writeKeys(batch({ a: 'h2' }, { expectedVersion: 0 })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results[0]!.ok ? 'h1' : 'h2';
    expect(await repo.findAllKeysVersioned(sessionId)).toEqual({ keys: { a: winner }, version: 1 });
  });
});

describe('writeKeys sem expectedVersion (Telegram, migração legada)', () => {
  it('cria a linha e incrementa a versão sem checagem; lote vazio é no-op', async () => {
    expect(await repo.writeKeys(batch({ s: 1 }))).toEqual({ ok: true, version: 0 });
    expect(await repo.writeKeys(batch({ s: 2 }))).toEqual({ ok: true, version: 1 });
    expect(await repo.writeKeys(batch({}))).toEqual({ ok: true, version: null });
    expect(await repo.findAllKeys(sessionId)).toEqual({ s: 2 });
    expect((await repo.findAllKeysVersioned(sessionId)).version).toBe(1);
  });
});
