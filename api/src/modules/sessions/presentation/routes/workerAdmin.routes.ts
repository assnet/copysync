import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ListWorkersUseCase, type ListWorkersOutput } from '../../application/use-cases/ListWorkersUseCase';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { ListLeaseHoldersUseCase, type ListLeaseHoldersOutput } from '../../application/use-cases/ListLeaseHoldersUseCase';
import { PrismaSessionLeaseHolderRepository } from '../../infrastructure/repositories/PrismaSessionLeaseHolderRepository';
import {
  workerCapacityResponse,
  workerListResponse,
  workerScaleEventsQuery,
  workerScaleEventsResponse,
  workerScaleRequestBody,
  workerScaleRequestResponse,
  workerScaleStateResponse,
  workerScalingSettingsBody,
  workerScalingSettingsResponse,
} from '../schemas/workerAdmin.schema';
import { presentWorkerScaleEvent, presentWorkerScaleState } from '../presenters/WorkerScalePresenter';
import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';
import { workerAdoptionConfig } from '../../../../shared/config/workerAdoption';
import {
  getWorkerCapacityUseCase,
  getWorkerScaleStateUseCase,
  getWorkerScalingSettingsUseCase,
  listWorkerScaleEventsUseCase,
  requestWorkerScaleUseCase,
  updateWorkerScalingSettingsUseCase,
} from '../../infrastructure/lease/sessionLeaseContainer';

const preHandler = [authHook, superAdminHook];
/** Escopo do cursor do histórico: cursor de outra lista não vale aqui. */
const SCALE_EVENTS_CURSOR_SCOPE = 'worker-scale-events';
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

  app.get('/capacity', {
    preHandler,
    schema: {
      tags,
      summary: 'Capacidade contratada por plano e do cluster (amostras locais; nunca chama a Render)',
      response: { 200: workerCapacityResponse },
    },
  }, async (_request, reply) => {
    httpResponse.ok(reply, await getWorkerCapacityUseCase().execute());
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

  app.get('/scale', {
    preHandler,
    schema: {
      tags,
      summary: 'Estado do escalador (cache de 30 s), faixa de réplicas, intervalo mínimo e último evento',
      response: { 200: workerScaleStateResponse },
    },
  }, async (_request, reply) => {
    httpResponse.ok(reply, presentWorkerScaleState(await getWorkerScaleStateUseCase().execute()));
  });

  app.post<{ Body: { replicas: number; reason: string; requestId: string } }>('/scale', {
    preHandler,
    schema: {
      tags,
      summary: 'Pede réplicas do worker ao provedor (estado lido ao vivo), idempotente por requestId, auditado',
      body: workerScaleRequestBody,
      response: { 200: workerScaleRequestResponse },
    },
  }, async (request, reply) => {
    const { event, replayed } = await requestWorkerScaleUseCase().execute({
      replicas: request.body.replicas,
      reason: request.body.reason,
      requestId: request.body.requestId,
      actorUserId: request.user.userId,
    });
    httpResponse.ok(reply, { event: presentWorkerScaleEvent(event), replayed });
  });

  app.get<{ Querystring: { cursor?: string } }>('/scale/events', {
    preHandler,
    schema: {
      tags,
      summary: 'Histórico de escala, mais recentes primeiro, por cursor opaco (sem identificar o ator)',
      querystring: workerScaleEventsQuery,
      response: { 200: workerScaleEventsResponse },
    },
  }, async (request, reply) => {
    const page = await listWorkerScaleEventsUseCase().execute(readCursor(request.query.cursor, SCALE_EVENTS_CURSOR_SCOPE));
    httpResponse.ok(reply, {
      items: page.items.map(presentWorkerScaleEvent),
      nextCursor: page.nextBeforeId === null ? null : createCursor(SCALE_EVENTS_CURSOR_SCOPE, page.nextBeforeId),
    });
  });
}
