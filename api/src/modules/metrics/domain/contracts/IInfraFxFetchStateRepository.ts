import type { InfraFxFetchState } from '../services/infraFxFetchState';

/** Estado da busca automática da cotação em `platform_settings["infra_fx_fetch_state"]` (nunca em memória). */
export interface IInfraFxFetchStateRepository {
  /** Ausente ou inválido = `null`. */
  get(): Promise<InfraFxFetchState | null>;
  save(state: InfraFxFetchState): Promise<void>;
}
