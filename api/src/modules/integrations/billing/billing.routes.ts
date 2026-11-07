import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyBillingHmac } from './verifyBillingHmac';
import { parseBillingSeq } from './parseBillingSeq';
import { ApplyBillingEventUseCase } from './ApplyBillingEventUseCase';
import { parseExpiresAt } from './parseExpiresAt';
import type { ApplyBillingEventInput } from './ApplyBillingEventUseCase';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';

const log = logger.child({ module: 'billing-webhook' });

/** `X-Application-Key` igual a `BILLING_APPLICATION_KEY` (comparação em tempo constante). */
export function isValidApplicationKey(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

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
          200: { type: 'object', properties: { ok: { type: 'boolean' }, outcome: { type: 'string' } } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const appKey = request.headers['x-application-key'] as string | undefined;
      if (!isValidApplicationKey(appKey, env.BILLING_APPLICATION_KEY)) {
        log.warn('Billing webhook application key rejected');
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const rawBody = request.body as Buffer;
      const signature = request.headers['x-signature'] as string | undefined;
      const timestamp = request.headers['x-timestamp'] as string | undefined;

      const hmac = verifyBillingHmac(signature, timestamp, rawBody);
      if (!hmac.valid) {
        log.warn({ reason: hmac.reason }, 'Billing webhook HMAC rejected');
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (hmac.matched === 'previous') {
        log.warn({ secret: 'previous' }, 'Billing webhook HMAC matched previous secret (rotation in progress)');
      } else {
        log.debug({ secret: 'current' }, 'Billing webhook HMAC matched current secret');
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        log.warn('Billing webhook invalid JSON');
        return reply.status(400).send({ error: 'invalid_json' });
      }

      const eventId = str(body.eventId);
      const eventType = str(body.type);
      const billingCustomerId = str(body.externalUserId);
      const seq = parseBillingSeq(body.seq);

      if (!eventId || !eventType || !billingCustomerId || seq === null) {
        log.warn({ eventId }, 'Billing webhook missing eventId, type, externalUserId or seq');
        return reply.status(400).send({ error: 'missing_fields' });
      }

      // Header informativo: ausente é aceito; presente tem de bater com o corpo assinado
      const headerEventId = request.headers['x-event-id'] as string | undefined;
      if (headerEventId !== undefined && headerEventId !== eventId) {
        log.warn({ eventId, headerEventId }, 'Billing webhook X-Event-Id does not match body eventId');
        return reply.status(400).send({ error: 'event_id_mismatch' });
      }

      // Ausente = mantém; `null` limpa; ISO grava; presente e malformado é recusado (não aplica nem avança o seq)
      let expiresAt: { expiresAt?: string | null } = {};
      if ('expiresAt' in body) {
        const parsed = parseExpiresAt(body.expiresAt);
        if (!parsed.valid) {
          log.warn({ eventId }, 'Billing webhook invalid expiresAt');
          return reply.status(400).send({ error: 'invalid_expires_at' });
        }
        expiresAt = { expiresAt: parsed.value?.toISOString() ?? null };
      }

      const input: ApplyBillingEventInput = {
        eventId,
        billingCustomerId,
        eventType,
        seq,
        payload: {
          email: str(body.email),
          name: str(body.name),
          planSlug: str(body.planSlug) ?? null,
          ...expiresAt,
        },
      };

      try {
        const result = await new ApplyBillingEventUseCase().execute(input);
        // Sem recibo: o hub retém, esgota as tentativas e o evento fica na fila DEAD com replay
        if (result.outcome === 'UNPROVISIONABLE') {
          return reply.status(422).send({ error: 'unprovisionable', reason: result.reason });
        }
        // Corte sem resposta da central: sem recibo; 5xx faz a central retentar
        if (result.outcome === 'HUB_UNAVAILABLE') {
          return reply.status(503).send({ error: 'hub_unavailable' });
        }
        return reply.send({ ok: true, outcome: result.outcome });
      } catch (err) {
        log.error({ err, eventId }, 'Billing webhook processing error');
        return reply.status(500).send({ error: 'internal' });
      }
    },
  );
}
