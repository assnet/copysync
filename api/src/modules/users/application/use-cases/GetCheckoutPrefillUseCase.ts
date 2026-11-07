import type { IUserRepository } from '../../domain/contracts/IUserRepository';
import { buildCheckoutPrefill, type CheckoutPrefill } from '../../domain/services/checkoutPrefill';

/**
 * Autopreenchimento do link de pagamento para o usuário logado. Usuário inexistente → `{}`
 * (o painel abre o link sem dados). Nunca logar o retorno: é dado pessoal.
 */
export class GetCheckoutPrefillUseCase {
  constructor(private readonly users: Pick<IUserRepository, 'findById'>) {}

  async execute(userId: string): Promise<CheckoutPrefill> {
    const user = await this.users.findById(userId);
    if (!user) return {};
    return buildCheckoutPrefill({ email: user.email, name: user.name });
  }
}
