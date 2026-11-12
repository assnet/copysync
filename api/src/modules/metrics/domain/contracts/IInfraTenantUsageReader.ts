import type { TenantSessionHourSample } from './IInfraCostSnapshotRepository';

/**
 * Foto por tenant `ACTIVE` para a sessão-hora (COST-12, T13): sessões `CONNECTED` com lease vivo
 * (relógio UTC do banco) e contratadas efetivas (limite de `tenant_entitlements`, mesma regra numérica do
 * `PrismaWorkerCapacityReader`; ilimitado = preset do plano, sem plano = 1 por canal). Tenant sem sessão
 * conectada também entra (contratadas contam na média). Leitura de super admin, só para o job.
 */
export interface IInfraTenantUsageReader {
  readHour(): Promise<TenantSessionHourSample[]>;
}
