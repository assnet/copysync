import type { IAiSettingsRepository } from '../../domain/contracts/IAiSettingsRepository';
import type { IAiAuditTrail } from '../../domain/contracts/IAiAuditTrail';
import type { AiSettings } from '../../domain/entities/AiSettings';
import { isValidAiSettings } from '../../domain/services/aiModes';
import { AiModesBothDisabledError } from '../../../../shared/errors/internal/AiErrors';

export class GetAiSettingsUseCase {
  constructor(private readonly repo: IAiSettingsRepository) {}

  execute(): Promise<AiSettings> {
    return this.repo.get();
  }
}

/** Grava os dois modos. Desligar ambos = 422 `AI_MODES_BOTH_DISABLED`. */
export class UpdateAiSettingsUseCase {
  constructor(
    private readonly repo: IAiSettingsRepository,
    private readonly audit: IAiAuditTrail,
  ) {}

  async execute(input: AiSettings & { userId: string }): Promise<AiSettings> {
    const next: AiSettings = { platformEnabled: input.platformEnabled, tenantKeysEnabled: input.tenantKeysEnabled };
    if (!isValidAiSettings(next)) throw new AiModesBothDisabledError();
    const saved = await this.repo.save(next, input.userId);
    await this.audit.record({ action: 'AI_SETTINGS_UPDATED', userId: input.userId, meta: { ...saved } });
    return saved;
  }
}
