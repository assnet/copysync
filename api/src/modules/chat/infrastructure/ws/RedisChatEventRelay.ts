import type { Redis } from 'ioredis';
import { logger } from '../../../../shared/logger/logger';
import type { ChatEventRelay, ChatWsEvent } from './ChatWebSocketPublisher';

/** Canal por tenant: `tenant:{tenantId}` (docs/arquitetura-escala.md §3.4). */
export const TENANT_CHANNEL_PREFIX = 'tenant:';
const TENANT_PATTERN = `${TENANT_CHANNEL_PREFIX}*`;

export type RedisChatEventRelayOptions =
  /** `worker`: `publish` vira `PUBLISH tenant:{id}`; cliente de comandos. */
  | { mode: 'publish'; client: Redis }
  /** `http`: `PSUBSCRIBE tenant:*` e entrega local; cliente em modo assinante. */
  | { mode: 'deliver'; client: Redis; deliver: (tenantId: string, payload: ChatWsEvent) => void };

/**
 * Fan-out de eventos do painel entre processos por Redis pub/sub. Melhor esforço, como o WS:
 * mensagem perdida (Redis fora, http reiniciando) não é reenviada; o painel recarrega pela API.
 */
export class RedisChatEventRelay implements ChatEventRelay {
  private listening = false;

  constructor(private readonly options: RedisChatEventRelayOptions) {}

  publish(tenantId: string, payload: ChatWsEvent): void {
    if (this.options.mode !== 'publish') {
      throw new Error('RedisChatEventRelay em modo deliver não publica');
    }
    this.options.client
      .publish(`${TENANT_CHANNEL_PREFIX}${tenantId}`, JSON.stringify(payload))
      .catch((err: unknown) => logger.warn({ err, tenantId }, 'Relay WS: PUBLISH falhou'));
  }

  /** Modo `deliver`: assina `tenant:*`. Idempotente. */
  async start(): Promise<void> {
    const opts = this.options;
    if (opts.mode !== 'deliver') throw new Error('RedisChatEventRelay.start só no modo deliver');
    if (this.listening) return;
    this.listening = true;
    opts.client.on('pmessage', this.onMessage);
    await opts.client.psubscribe(TENANT_PATTERN);
  }

  /** Para de assinar. Idempotente; não fecha o cliente (dono: `closeAllRedis`). */
  async stop(): Promise<void> {
    const opts = this.options;
    if (opts.mode !== 'deliver' || !this.listening) return;
    this.listening = false;
    opts.client.off('pmessage', this.onMessage);
    await opts.client.punsubscribe(TENANT_PATTERN);
  }

  private readonly onMessage = (pattern: string, channel: string, message: string): void => {
    if (pattern !== TENANT_PATTERN || this.options.mode !== 'deliver') return;
    const tenantId = channel.slice(TENANT_CHANNEL_PREFIX.length);
    if (!tenantId) return;
    let payload: ChatWsEvent;
    try {
      payload = JSON.parse(message) as ChatWsEvent;
    } catch (err) {
      logger.warn({ err, channel }, 'Relay WS: mensagem inválida descartada');
      return;
    }
    this.options.deliver(tenantId, payload);
  };
}
