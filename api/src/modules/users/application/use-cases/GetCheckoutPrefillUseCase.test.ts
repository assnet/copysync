import { describe, expect, it, vi } from 'vitest';
import { GetCheckoutPrefillUseCase } from './GetCheckoutPrefillUseCase';
import type { User } from '../../domain/entities/User';

describe('GetCheckoutPrefillUseCase', () => {
  it('monta o prefill a partir do usuário', async () => {
    const findById = vi.fn().mockResolvedValue({ email: 'Ana@X.com', name: 'Ana' } as User);
    await expect(new GetCheckoutPrefillUseCase({ findById }).execute('u1')).resolves.toEqual({
      email: 'ana@x.com', confirmEmail: 'ana@x.com', name: 'Ana',
    });
    expect(findById).toHaveBeenCalledWith('u1');
  });

  it('usuário inexistente → {}', async () => {
    await expect(new GetCheckoutPrefillUseCase({ findById: async () => null }).execute('u1')).resolves.toEqual({});
  });
});
