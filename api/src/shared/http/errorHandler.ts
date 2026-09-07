import type { FastifyError, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { logger } from '../logger/logger';

/**
 * Global Fastify error handler.
 * Translates AppError and ZodError into consistent HTTP responses.
 * Raw/unexpected errors are logged and returned as 500.
 */
export function errorHandler(
  error: FastifyError | Error,
  _request: unknown,
  reply: FastifyReply,
): void {
  // Zod validation errors (thrown manually or from schema parsing)
  if (error instanceof ZodError) {
    const fields = error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        fields,
      },
    });
    return;
  }

  // Application-defined errors — known, expected, safe to expose
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(
        { err: error, code: error.code, meta: error.meta },
        'Application error [5xx]',
      );
    }

    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.meta ? { meta: error.meta } : {}),
      },
    });
    return;
  }

  // Fastify built-in errors (e.g. 404 from route not found, 415, etc.)
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: 'HTTP_ERROR',
        message: error.message,
      },
    });
    return;
  }

  // Unexpected errors — log fully, respond vaguely
  logger.error({ err: error }, 'Unhandled error');
  reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
