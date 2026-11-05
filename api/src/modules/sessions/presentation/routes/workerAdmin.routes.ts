import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ListWorkersUseCase, type ListWorkersOutput } from '../../application/use-cases/ListWorkersUseCase';
import { PrismaWorkerHeartbeatRepository } from '../../infrastructure/repositories/PrismaWorkerHeartbeatRepository';
import { PrismaSessionAdoptionRepository } from '../../infrastructure/repositories/PrismaSessionAdoptionRepository';
import { workerListResponse } from '../schemas/workerAdmin.schema';
import { workerAdoptionConfig } from '../../../../shared/config/workerAdoption';

const preHandler = [authHook, superAdminHook];
const tags = ['Workers (admin)'];

let listWorkers: ListWorkersUseCase | null = null;
const uc = () =>
  (listWorkers ??= new ListWorkersUseCase(new PrismaWorkerHeartbeatRepository(), new PrismaSessionAdoptionRepository()));

/** Flag desligada: nada de heartbeat nem adoção — resposta vazia sem consultar o banco. */
const EMPTY: ListWorkersOutput = { workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0 };

const present = (out: ListWorkersOutput) => ({
  workers: out.workers.map((w) => ({ ...w, seenAt: w.seenAt.toISOString() })),
  totals: out.totals,
  awaiting: out.awaiting,
});

/** Super admin: ocupação dos workers (ADOPT-12). Registrado em `/api/admin/workers`. */
export async function workerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Workers vivos, ocupação e sessões aguardando capacidade', response: { 200: workerListResponse } },
  }, async (_request, reply) => {
    const out = workerAdoptionConfig().enabled ? await uc().execute() : EMPTY;
    httpResponse.ok(reply, present(out));
  });
}
