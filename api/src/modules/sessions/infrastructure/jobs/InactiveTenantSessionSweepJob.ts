import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { InactiveTenantSessionDisconnector } from '../../application/services/InactiveTenantSessionDisconnector';
import { logger } from '../../../../shared/logger/logger';

export const INACTIVE_TENANT_SWEEP_MS = 30_000;

export interface InactiveTenantSessionSweepJobOptions {
  sessions: Pick<ISessionRepository, 'findWithInactiveTenant'>;
  disconnector: Pick<InactiveTenantSessionDisconnector, 'disconnect'>;
  /** Sessões com socket local deste processo (`sessionLeaseContainer().listLocal`). */
  listLocal: () => readonly string[];
  intervalMs?: number;
}

/**
 * Varredura por processo que roda sessões (OWN-04): a cada 30 s, as sessões **locais** cujo tenant
 * não está `ACTIVE` são desconectadas como no listener de suspensão. Cobre a suspensão detectada em
 * outro processo (o listener de lá não toca sessão com lease vivo daqui). Sem sockets locais não
 * consulta o banco. Timer `unref`; falha só loga.
 */
export class InactiveTenantSessionSweepJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly log = logger.child({ module: 'InactiveTenantSessionSweepJob' });

  constructor(private readonly options: InactiveTenantSessionSweepJobOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? INACTIVE_TENANT_SWEEP_MS);
    this.timer.unref();
  }

  /** Para o timer e espera a passada em curso. Nunca lança. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** Exposto para teste; passadas não se sobrepõem. Nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.sweepOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async sweepOnce(): Promise<void> {
    const local = this.options.listLocal();
    if (local.length === 0) return;
    let targets: Array<{ id: string; tenantId: string }>;
    try {
      targets = await this.options.sessions.findWithInactiveTenant(local);
    } catch (err) {
      this.log.warn({ err }, 'falha ao buscar sessões locais de tenant inativo');
      return;
    }
    if (targets.length === 0) return;
    this.log.info({ count: targets.length }, 'Disconnecting local sessions of inactive tenants');
    for (const { id, tenantId } of targets) {
      try {
        await this.options.disconnector.disconnect(id, tenantId, 'TENANT_NOT_ACTIVE');
      } catch (err) {
        this.log.error({ err, sessionId: id }, 'Failed to disconnect local session of inactive tenant');
      }
    }
  }
}
