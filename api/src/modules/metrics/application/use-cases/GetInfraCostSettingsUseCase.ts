import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import {
  resolveInfraCostSettings,
  type InfraCostSettings,
  type InfraCostSettingsSource,
} from '../../domain/services/infraCostSettings';

/** Resposta de `GET`/`PUT /admin/costs/settings` (COST-01/03). */
export interface InfraCostSettingsView {
  settings: InfraCostSettings;
  origin: InfraCostSettingsSource;
  /** ISO do último salvamento; `null` sem linha. Vai como `expectedUpdatedAt` no PUT. */
  updatedAt: string | null;
}

/**
 * Super admin lê a configuração efetiva (COST-02): sem linha ou linha inválida → valores iniciais com
 * origem `default`; o `updatedAt` é o real da linha (linha inválida também), para o PUT não dar 409.
 */
export class GetInfraCostSettingsUseCase {
  constructor(private readonly repository: IInfraCostSettingsRepository) {}

  async execute(): Promise<InfraCostSettingsView> {
    const record = await this.repository.get();
    const effective = resolveInfraCostSettings(record);
    return { settings: effective.value, origin: effective.origin, updatedAt: record?.updatedAt.toISOString() ?? null };
  }
}
