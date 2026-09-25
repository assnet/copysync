import type {
  IOutboundMediaQueue,
  OutboundMediaJob,
} from '../../application/contracts/IOutboundMediaQueue';
import { logger as sharedLogger } from '../../../../shared/logger/logger';

/** Só o que a fila registra; o logger compartilhado (pino) satisfaz. */
export interface OutboundMediaQueueLogger {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface InMemoryOutboundMediaQueueOptions {
  /** Despacho de um job (relê a mensagem e envia ao WhatsApp). */
  run: (job: OutboundMediaJob) => Promise<void>;
  /** Envios simultâneos no processo inteiro (`MEDIA_SEND_CONCURRENCY`). */
  globalConcurrency: number;
  /** Envios simultâneos por sessão, em conversas diferentes (`MEDIA_SEND_PER_SESSION`). */
  perSessionConcurrency: number;
  /** Teto de jobs por sessão, somando os na fila e os em envio (`MEDIA_SEND_QUEUE_MAX_PER_SESSION`). */
  maxQueuedPerSession: number;
  logger?: OutboundMediaQueueLogger;
}

/**
 * Fila de envio de mídia em memória, por instância da API.
 *
 * Regras de agendamento:
 * - mesma conversa: um job por vez, na ordem de chegada (preserva a ordem do lote);
 * - mesma sessão: até `perSessionConcurrency` conversas em paralelo, para um vídeo longo não
 *   travar os outros operadores do mesmo número;
 * - processo: até `globalConcurrency` envios (limita `/tmp` e banda).
 *
 * Vaga liberada vai para o primeiro job elegível por ordem de chegada. Como os bloqueios de um
 * job (conversa ocupada, sessão cheia, global cheio) valem também para os seguintes da mesma
 * conversa, essa varredura nunca fura a fila de uma conversa.
 *
 * O estado não é crítico: a mensagem já está gravada como `PENDING` antes do `enqueue`. Perder a
 * fila num restart (ou no `drain`) deixa mensagens `PENDING`, que a recuperação resolve.
 * Uma única instância deve ser compartilhada pelo módulo.
 */
export class InMemoryOutboundMediaQueue implements IOutboundMediaQueue {
  /** Jobs aguardando vaga, em ordem de chegada. */
  private waiting: OutboundMediaJob[] = [];
  private readonly running = new Set<OutboundMediaJob>();
  /** Conversas com envio em andamento (chave sessão + conversa). */
  private readonly busyConversations = new Set<string>();
  /** sessionId → jobs em envio. */
  private readonly runningBySession = new Map<string, number>();
  /** sessionId → jobs na fila + em envio (base do teto). */
  private readonly loadBySession = new Map<string, number>();
  /** Chamados quando o último envio em andamento termina (espera do `drain`). */
  private idleWaiters: Array<() => void> = [];
  private draining = false;
  private readonly log: OutboundMediaQueueLogger;

  constructor(private readonly options: InMemoryOutboundMediaQueueOptions) {
    this.log = options.logger ?? sharedLogger.child({ module: 'InMemoryOutboundMediaQueue' });
  }

  enqueue(job: OutboundMediaJob): boolean {
    if (this.draining) return false;
    if ((this.loadBySession.get(job.sessionId) ?? 0) >= this.options.maxQueuedPerSession) {
      return false;
    }

    increment(this.loadBySession, job.sessionId);
    this.waiting.push(job);
    this.pump();
    return true;
  }

  inFlightIds(): string[] {
    return [...this.waiting, ...this.running].map((job) => job.messageId);
  }

  /**
   * Para de aceitar jobs e espera os em envio até `timeoutMs`, sem lançar.
   *
   * O que estava só na fila é descartado aqui, sem chegar a rodar: a mensagem continua `PENDING`
   * no banco e a recuperação do próximo boot a marca como `FAILED` (o operador reenvia). Começar
   * um envio novo durante o shutdown só aumentaria o que fica cortado no meio.
   */
  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;

    const dropped = this.waiting;
    this.waiting = [];
    for (const job of dropped) decrement(this.loadBySession, job.sessionId);
    if (dropped.length > 0) {
      this.log.warn(
        { count: dropped.length, messageIds: dropped.map((job) => job.messageId) },
        'Envios de mídia descartados no shutdown; ficam PENDING para a recuperação',
      );
    }

    if (this.running.size === 0) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Inicia, em ordem de chegada, todo job que couber nos limites. */
  private pump(): void {
    for (let i = 0; i < this.waiting.length; ) {
      if (this.running.size >= this.options.globalConcurrency) return;

      const job = this.waiting[i];
      if (this.canStart(job)) {
        this.waiting.splice(i, 1);
        this.start(job);
      } else {
        i++;
      }
    }
  }

  private canStart(job: OutboundMediaJob): boolean {
    return (
      !this.busyConversations.has(conversationKey(job)) &&
      (this.runningBySession.get(job.sessionId) ?? 0) < this.options.perSessionConcurrency
    );
  }

  private start(job: OutboundMediaJob): void {
    this.running.add(job);
    this.busyConversations.add(conversationKey(job));
    increment(this.runningBySession, job.sessionId);

    // O despacho começa num microtask: `enqueue` nunca roda o envio no próprio passo, e um
    // `run` que lance de forma síncrona vira rejeição, tratada como qualquer outra falha.
    void Promise.resolve()
      .then(() => this.options.run(job))
      .catch((err: unknown) => {
        this.log.error(
          {
            err,
            messageId: job.messageId,
            tenantId: job.tenantId,
            sessionId: job.sessionId,
            conversationId: job.conversationId,
          },
          'Falha no envio de mídia da fila',
        );
      })
      .finally(() => this.finish(job));
  }

  private finish(job: OutboundMediaJob): void {
    this.running.delete(job);
    this.busyConversations.delete(conversationKey(job));
    decrement(this.runningBySession, job.sessionId);
    decrement(this.loadBySession, job.sessionId);

    this.pump();

    if (this.running.size === 0 && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const notify of waiters) notify();
    }
  }
}

function conversationKey(job: OutboundMediaJob): string {
  return `${job.sessionId}\u0000${job.conversationId}`;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Remove a chave ao zerar, para os mapas não crescerem com sessões antigas. */
function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}
