import type { FastifyReply } from 'fastify';

/**
 * Helpers for consistent HTTP response shapes.
 *
 * Success: { success: true, data: T }
 * Created: { success: true, data: T } with 201
 * Accepted: { success: true, data: T } with 202 — aceito, o trabalho segue em segundo plano
 * No content: 204 with empty body
 */
export const httpResponse = {
  ok<T>(reply: FastifyReply, data: T): void {
    reply.status(200).send({ success: true, data });
  },

  created<T>(reply: FastifyReply, data: T): void {
    reply.status(201).send({ success: true, data });
  },

  accepted<T>(reply: FastifyReply, data: T): void {
    reply.status(202).send({ success: true, data });
  },

  noContent(reply: FastifyReply): void {
    reply.status(204).send();
  },
};
