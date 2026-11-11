import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ListWorkersUseCase, type ListWorkersOutput } from '../../application/use-cases/ListWorkersUseCase';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { ListLeaseHoldersUseCase, type ListLeaseHoldersOutput } from '../../application/use-cases/ListLeaseHoldersUseCase';
import { PrismaSessionLeaseHolderRepository } from '../../infrastructure/repositories/PrismaSessionLeaseHolderRepository';
import { workerListResponse, workerScalingSettingsBody, workerScalingSettingsResponse } from '../schemas/workerAdmin.schema';
import { workerAdoptionConfig } from '../../../../shared/config/workerAdoption';
import {
  getWorkerScalingSettingsUseCase,
  updateWorkerScalingSettingsUseCase,
} from '../../infrastructure/lease/sessionLeaseContainer';

const preHandler = [authHook, superAdminHook];
const tags = ['Workers (admin)'];

let listWorkers: ListWorkersUseCase | null = null;
const uc = () =>
  (listWorkers ??= new ListWorkersUseCase(new PrismaWorkerHeartbeatRepository(), new PrismaSessionAdoptionRepository()));

let listHolders: ListLeaseHoldersUseCase | null = null;
const holdersUc = () => (listHolders ??= new ListLeaseHoldersUseCase(new PrismaSessionLeaseHolderRepository()));

/** Flag desligada: sem heartbeat nem adoção — workers vazio; os processos vêm dos leases vivos. */
const NO_WORKERS: ListWorkersOutput = { workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0 };
/** Flag ligada: a tela usa os heartbeats; leases não são consultados. */
const NO_HOLDERS: ListLeaseHoldersOutput = { processes: [], leasedSessions: 0 };

const present = (adoptionEnabled: boolean, out: ListWorkersOutput, holders: ListLeaseHoldersOutput) => ({
  adoptionEnabled,
  workers: out.workers.map((w) => ({ ...w, seenAt: w.seenAt.toISOString() })),
  totals: out.totals,
  awaiting: out.awaiting,
  processes: holders.processes.map((p) => ({ ...p, leaseUntil: p.leaseUntil.toISOString() })),
  leasedSessions: holders.leasedSessions,
});

/**
 * Super admin: ocupação dos workers (ADOPT-12). Registrado em `/api/admin/workers`.
 * Adoção desligada (`WORKER_ADOPTION_ENABLED`): `processes` = leases vivos por processo, sem teto.
 * Visão de plataforma, só leitura e sem tenant (docs/arquitetura-escala.md).
 */
export async function workerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Workers vivos, ocupação, sessões aguardando capacidade e leases por processo (adoção desligada)', response: { 200: workerListResponse } },
  }, async (_request, reply) => {
    const enabled = workerAdoptionConfig().enabled;
    const [out, holders] = enabled
      ? [await uc().execute(), NO_HOLDERS]
      : [NO_WORKERS, await holdersUc().execute()];
    httpResponse.ok(reply, present(enabled, out, holders));
  });

  app.get('/settings', {
    preHandler,
    schema: { tags, summary: 'Configuração de escala efetiva, origem por campo e se está em vigor', response: { 200: workerScalingSettingsResponse } },
  }, async (_request, reply) => {
    httpResponse.ok(reply, await getWorkerScalingSettingsUseCase().execute());
  });

  app.put<{ Body: { settings: unknown; expectedUpdatedAt: string | null } }>('/settings', {
    preHandler,
    schema: {
      tags,
      summary: 'Grava a configuração de escala (objeto completo, com controle de concorrência), auditado',
      body: workerScalingSettingsBody,
      response: { 200: workerScalingSettingsResponse },
    },
  }, async (request, reply) => {
    const data = await updateWorkerScalingSettingsUseCase().execute({
      settings: request.body.settings,
      expectedUpdatedAt: request.body.expectedUpdatedAt,
      actorUserId: request.user.userId,
    });
    httpResponse.ok(reply, data);
  });
}
