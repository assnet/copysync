import type { Prisma, PrismaClient } from '@prisma/client';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import {
  parseInfraFxFetchState,
  serializeInfraFxFetchState,
  type InfraFxFetchState,
} from '../../domain/services/infraFxFetchState';

/** Chave em `platform_settings` do estado da busca da cotação (design §4). */
export const INFRA_FX_FETCH_STATE_KEY = 'infra_fx_fetch_state';

/** Estado interno do job: upsert simples (só o dono do lease `infra-fx-rate` grava), sem auditoria. */
export class PrismaInfraFxFetchStateRepository implements IInfraFxFetchStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<InfraFxFetchState | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: INFRA_FX_FETCH_STATE_KEY } });
    return row ? parseInfraFxFetchState(row.value) : null;
  }

  async save(state: InfraFxFetchState): Promise<void> {
    const value = serializeInfraFxFetchState(state) as Prisma.InputJsonValue;
    await this.prisma.platformSetting.upsert({
      where: { key: INFRA_FX_FETCH_STATE_KEY },
      create: { key: INFRA_FX_FETCH_STATE_KEY, value },
      update: { value },
    });
  }
}
