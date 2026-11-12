import type { IHuntAiAvailability } from '../../application/hunter/contracts/IHuntAiAvailability';

/**
 * Disponibilidade de IA pelo status do módulo `assistants` (modo efetivo ≠ `NONE`), resolvido só no uso:
 * importar não carrega provedores nem toca banco. Não usa a cifra nem chama provedor.
 */
export class LazyHuntAiAvailability implements IHuntAiAvailability {
  async isAvailable(tenantId: string): Promise<boolean> {
    const { assistantsContainer } = await import('../../../assistants/infrastructure/assistantsContainer');
    const status = await assistantsContainer.useCases().status.execute(tenantId);
    return status.mode !== 'NONE';
  }
}
