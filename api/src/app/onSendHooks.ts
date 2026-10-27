import path from 'path';
import type { FastifyReply, FastifyRequest, onSendHookHandler } from 'fastify';
import { contentDispositionHeader } from '../shared/storage/staticMediaPolicy';

/**
 * Hooks `onSend` globais. SÃO SÍNCRONOS DE PROPÓSITO (assinatura com `done`), e precisam
 * continuar assim.
 *
 * Com `onSend` async, `reply.send()` devolve antes de a resposta ser escrita. Nesse intervalo
 * `reply.sent`/`headersSent` ainda são false, e o Fastify (a) chama o handler depois de um
 * hook que já respondeu e (b) em handler async que chama `reply.send()` sem `return reply`,
 * chama `send` de novo. A segunda escrita lança `ERR_HTTP_HEADERS_SENT` dentro de uma
 * promise — rejeição não tratada, e o Node derruba o processo. Com um único hook async a
 * ordem das microtasks escondia o problema; com dois, acontece em toda requisição
 * (incidente 2026-10-27, API em loop de queda). Hook síncrono escreve dentro do `send`,
 * e as checagens voltam a valer. Teste: `onSendHooks.test.ts`.
 */

/** Relógio do servidor em ms: o painel corrige o relógio local em contagens regressivas. */
export const serverTimeHook: onSendHookHandler = (_request, reply, _payload, done) => {
  reply.header('X-Server-Time', String(Date.now()));
  done();
};

/**
 * `?name=` põe o nome original no download: link cross-origin ignora o atributo `download`
 * do painel. O `setHeaders` do plugin estático não vê a requisição, por isso o hook.
 */
export function storageDispositionHook(storagePrefix: string): onSendHookHandler {
  return (request: FastifyRequest, reply: FastifyReply, _payload, done) => {
    if (request.url.startsWith(storagePrefix)) {
      const name = (request.query as Record<string, unknown> | undefined)?.name;
      if (typeof name === 'string' && name) {
        const ext = path.extname(request.url.split('?')[0]!);
        reply.header('Content-Disposition', contentDispositionHeader(ext, name));
      }
    }
    done();
  };
}
