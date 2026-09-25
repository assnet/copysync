/**
 * Registros de eco de envio, únicos por processo.
 *
 * Há duas instâncias do adapter no processo (bootstrap em `server.ts` e rotas em
 * `session.routes.ts`). Os sockets são compartilhados (`BaileysSessionRegistry`), mas os
 * handlers ficam presos ao adapter que abriu o socket: registro por instância faria o envio
 * registrar num e o eco conferir noutro. Por isso os registros vivem aqui, no módulo.
 *
 * - `reactions`: marca `isEcho` no `messages.reaction`
 * - `media`: descarta o eco da nossa mídia no `messages.upsert`, antes do download.
 *   TTL longo porque o eco só sai depois do upload
 *
 * TTL e teto vêm de `shared/config/env.ts` (o de reação é derivado do limite de envio).
 */
import { env } from '../../../../../shared/config/env';
import { logger as appLogger } from '../../../../../shared/logger/logger';
import { OutboundEchoRegistry } from './OutboundEchoRegistry';

const baileysLogger = appLogger.child({ module: 'baileys' });

export interface OutboundEchoRegistries {
  reactions: OutboundEchoRegistry;
  media: OutboundEchoRegistry;
}

let registries: OutboundEchoRegistries | null = null;

export function outboundEchoRegistries(): OutboundEchoRegistries {
  registries ??= {
    reactions: new OutboundEchoRegistry({
      ttlMs: env.REACTION_ECHO_TTL_MS,
      maxPerSession: env.REACTION_ECHO_MAX_PER_SESSION,
      onForcedEviction: (sessionId, reactionId) => {
        // Só acontece se o limite de envio foi afrouxado sem ajustar o TTL: um eco
        // legítimo pode perder a marca e cair na regra do celular.
        baileysLogger.warn({ sessionId, reactionId }, 'Reaction echo registry full — dropped id still within TTL');
      },
    }),
    media: new OutboundEchoRegistry({
      ttlMs: env.MEDIA_ECHO_TTL_MS,
      maxPerSession: env.MEDIA_ECHO_MAX_PER_SESSION,
      onForcedEviction: (sessionId, messageId) => {
        // O eco que perde a marca seria baixado de volta do WhatsApp (arquivo inteiro).
        baileysLogger.warn({ sessionId, messageId }, 'Media echo registry full — dropped id still within TTL');
      },
    }),
  };
  return registries;
}
