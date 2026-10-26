import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyBillingHmac } from './verifyBillingHmac';
import { ApplyBillingEventUseCase } from './ApplyBillingEventUseCase';
import type { ApplyBillingEventInput, BillingEventType } from './ApplyBillingEventUseCase';
import { logger } from '../../../shared/logger/logger';

const log = logger.child({ module: 'billing-webhook' });

const KNOWN_EVENT_TYPES = new Set<string>([
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.renewed',
  'payment.succeeded',
  'payment.failed',
]);

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // Raw body parser — HMAC needs the exact bytes
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request: FastifyRequest, body: Buffer, done: (err: null, result: Buffer) => void) => {
      done(null, body);
    },
  );

  app.post(
    '/webhook',
    {
      schema: {
        tags: ['Billing'],
        summary: 'Webhook receiver for billing hub events',
        hide: true,
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const signature = request.headers['x-signature'] as string | undefined;
      const timestamp = request.headers['x-timestamp'] as string | undefined;

      const hmac = verifyBillingHmac(signature, timestamp, rawBody);
      if (!hmac.valid) {
        log.warn({ reason: hmac.reason }, 'Billing webhook HMAC rejected');
        return reply.status(401).send({ error: 'unauthorized' });
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        log.warn('Billing webhook invalid JSON');
        return reply.status(400).send({ error: 'invalid_json' });
      }

      const eventId = body.eventId as string | undefined;
      const eventType = body.eventType as string | undefined;
      const billingCustomerId = (body.data as Record<string, unknown>)?.customerId as string | undefined
        ?? body.billingCustomerId as string | undefined;
      const seq = body.seq as number | undefined;

      if (!eventId || !eventType) {
        log.warn('Billing webhook missing eventId or eventType');
        return reply.status(400).send({ error: 'missing_fields' });
      }

      if (!billingCustomerId || seq === undefined) {
        log.warn({ eventId }, 'Billing webhook missing billingCustomerId or seq');
        return reply.status(400).send({ error: 'missing_fields' });
      }

      if (!KNOWN_EVENT_TYPES.has(eventType)) {
        log.warn({ eventId, eventType }, 'Billing webhook unknown event type');
        return reply.send({ ok: true, outcome: 'IGNORED' });
      }

      const input: ApplyBillingEventInput = {
        eventId,
        billingCustomerId,
        eventType: eventType as BillingEventType,
        seq,
        payload: (body.data as Record<string, unknown>) ?? body,
      };

      try {
        const useCase = new ApplyBillingEventUseCase();
        const result = await useCase.execute(input);

        log.info({ eventId, outcome: result.outcome }, 'Billing event processed');
        return reply.send({ ok: true, outcome: result.outcome });
      } catch (err) {
        log.error({ err, eventId }, 'Billing webhook processing error');
        return reply.status(500).send({ error: 'internal' });
      }
    },
  );
}
