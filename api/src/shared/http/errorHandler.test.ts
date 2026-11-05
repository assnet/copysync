import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { EngineCommandOutcomeUnknownError } from '../errors/internal/MessagingErrors';
import { errorHandler } from './errorHandler';

function fakeReply() {
  const reply = { status: vi.fn(), send: vi.fn() };
  reply.status.mockReturnValue(reply);
  return reply;
}

describe('errorHandler', () => {
  it('resultado desconhecido do comando vira 504 com código e texto próprios', () => {
    const reply = fakeReply();
    errorHandler(new EngineCommandOutcomeUnknownError(), undefined, reply as unknown as FastifyReply);
    expect(reply.status).toHaveBeenCalledWith(504);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'ENGINE_COMMAND_OUTCOME_UNKNOWN',
        message: 'Não foi possível confirmar o envio; confira a conversa antes de reenviar',
      },
    });
  });
});
