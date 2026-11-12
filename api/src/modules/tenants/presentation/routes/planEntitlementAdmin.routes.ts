import type { FastifyInstance } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { superAdminHook } from '../../../../shared/http/hooks/superAdminHook';
import { ListAdminPlanEntitlementsUseCase } from '../../application/use-cases/ListAdminPlanEntitlementsUseCase';
import { SetPlanEntitlementUseCase } from '../../application/use-cases/SetPlanEntitlementUseCase';
import { createPlanEntitlementPresetRepository, prismaPlanEntitlementTransaction } from '../../infrastructure/planEntitlementTransaction';
import { PLAN_SLUGS } from '../../domain/planPresets';

const preHandler = [authHook, superAdminHook];
const tags = ['Plan entitlements (admin)'];

let listUc: ListAdminPlanEntitlementsUseCase | null = null;
const list = () => (listUc ??= new ListAdminPlanEntitlementsUseCase(createPlanEntitlementPresetRepository()));
let setUc: SetPlanEntitlementUseCase | null = null;
const set = () => (setUc ??= new SetPlanEntitlementUseCase(prismaPlanEntitlementTransaction));

const presetValue = { type: ['boolean', 'number', 'null'] } as const;

/** Valor gravável: o tipo exato e a faixa de cada chave são validados no use case. */
const editableValue = { type: ['boolean', 'integer'] } as const;

const valueType = {
  type: 'object',
  properties: { kind: { type: 'string', enum: ['boolean', 'integer'] }, min: { type: 'integer' }, max: { type: 'integer' } },
} as const;

const listResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        plans: { type: 'array', items: { type: 'string' } },
        entitlements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              type: valueType,
              plans: { type: 'object', properties: Object.fromEntries(PLAN_SLUGS.map((p) => [p, presetValue])) },
            },
          },
        },
      },
    },
  },
} as const;

const setParams = {
  type: 'object',
  required: ['planSlug', 'key'],
  properties: { planSlug: { type: 'string', maxLength: 64 }, key: { type: 'string', maxLength: 128 } },
} as const;

const setBody = {
  type: 'object',
  required: ['value'],
  additionalProperties: false,
  properties: { value: editableValue },
} as const;

const setResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        planSlug: { type: 'string' },
        key: { type: 'string' },
        value: editableValue,
        tenantsUpdated: { type: 'integer' },
      },
    },
  },
} as const;

/**
 * Super admin: entitlements editáveis por plano (allowlist em `adminEditableEntitlements.ts`).
 * Registrado em `/api/admin/plan-entitlements`. Alterar propaga para os tenants do plano e audita; não chama a central.
 */
export async function planEntitlementAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler,
    schema: { tags, summary: 'Chaves editáveis (tipo e faixa) × planos, com o valor atual do preset', response: { 200: listResponse } },
  }, async (_request, reply) => {
    const entitlements = await list().execute();
    return reply.status(200).send({ success: true, data: { plans: [...PLAN_SLUGS], entitlements } });
  });

  app.put<{ Params: { planSlug: string; key: string }; Body: { value: boolean | number } }>('/:planSlug/:key', {
    preHandler,
    schema: {
      tags,
      summary: 'Altera a chave no plano (boolean ou inteiro na faixa): preset + tenants do plano na mesma transação, auditado',
      params: setParams,
      body: setBody,
      response: { 200: setResponse },
    },
  }, async (request, reply) => {
    const out = await set().execute({ ...request.params, value: request.body.value, actorUserId: request.user.userId });
    return reply.status(200).send({ success: true, data: out });
  });
}
