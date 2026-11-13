// Registry das marcas do caçador: uma entrada por `HuntProvider` (falta = erro de composição no boot do container).
import type { IHuntProviderAdapter, IHuntProviderRegistry } from '../../domain/contracts/hunter/IHuntProviderAdapter';
import { HUNT_PROVIDERS, type HuntProvider } from '../../domain/hunter/HuntProvider';

export class HuntProviderRegistry implements IHuntProviderRegistry {
  private readonly byProvider: ReadonlyMap<HuntProvider, IHuntProviderAdapter>;
  constructor(adapters: readonly IHuntProviderAdapter[]) {
    this.byProvider = new Map(adapters.map((a) => [a.provider, a]));
    const missing = HUNT_PROVIDERS.filter((p) => !this.byProvider.has(p));
    if (missing.length > 0) throw new Error(`hunt provider adapter missing: ${missing.join(',')}`);
  }
  get(provider: HuntProvider): IHuntProviderAdapter {
    const a = this.byProvider.get(provider);
    if (!a) throw new Error(`hunt provider adapter missing: ${provider}`);
    return a;
  }
}
