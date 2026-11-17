import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createExtensionAffiliatesHook } from './extensionAffiliatesHook';

vi.mock('../../../shared/database/prisma.client', () => ({ prisma: {} }));

const req = (mlTenantId?: string) =>
  ({ extensionSession: mlTenantId ? { mlTenantId } : undefined }) as unknown as FastifyRequest;

describe('extensionAffiliatesHook', () => {
  it('Afiliados ativo passa; consulta pelo mlTenantId', async () => {
    const has = vi.fn(async () => true);
    await expect(createExtensionAffiliatesHook({ has })(req('t-ext'))).resolves.toBeUndefined();
    expect(has).toHaveBeenCalledWith('t-ext', 'AFFILIATES');
  });

  it('Afiliados inativo → 403 PRODUCT_UNAVAILABLE', async () => {
    await expect(createExtensionAffiliatesHook({ has: async () => false })(req('t-ext')))
      .rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE', statusCode: 403 });
  });

  it('sem sessão da extensão não consulta', async () => {
    const has = vi.fn(async () => false);
    await createExtensionAffiliatesHook({ has })(req());
    expect(has).not.toHaveBeenCalled();
  });
});
