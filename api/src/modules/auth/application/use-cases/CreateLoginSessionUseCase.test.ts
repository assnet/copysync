import { describe, expect, it } from 'vitest';
import { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IAuthRepository } from '../../domain/contracts/IAuthRepository';

const user = { id: 'u1', name: 'Ana', email: 'ana@exemplo.com', isSuperAdmin: false };
const tenant = { tenantId: 't1', tenantName: 'Loja', tenantSlug: 'loja', tenantStatus: 'ACTIVE', role: 'ADMIN' };
const userRepo = { findTenantsForUser: async () => [tenant] } as unknown as IUserRepository;
const authRepo = { saveRefreshToken: async () => {} } as unknown as IAuthRepository;

describe('CreateLoginSessionUseCase · products', () => {
  it('com leitor: tenants ganham products', async () => {
    const uc = new CreateLoginSessionUseCase(userRepo, authRepo, () => ({ list: async () => ['AFFILIATES', 'CHAT'] }));
    expect((await uc.execute(user)).tenants).toEqual([{ ...tenant, products: ['AFFILIATES', 'CHAT'] }]);
  });

  it('leitor falhando não barra o login (campo omitido)', async () => {
    const uc = new CreateLoginSessionUseCase(userRepo, authRepo, () => ({ list: async () => { throw new Error('db'); } }));
    expect((await uc.execute(user)).tenants).toEqual([tenant]);
  });

  it('sem leitor: igual a antes', async () => {
    expect((await new CreateLoginSessionUseCase(userRepo, authRepo).execute(user)).tenants).toEqual([tenant]);
  });
});
