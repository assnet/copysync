import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';
import type { ISessionSocketControl } from '../../domain/contracts/ISessionSocketControl';
import { SessionNotOwnedError } from '../../../../shared/errors/internal/SessionErrors';
import { engineCallKind, engineCallSessionId, type EngineCall, type EngineMethod } from './engineCallPlan';
import type { IEngineCallHandler } from './ports';

/** Só o que o servidor usa de `ReleaseSessionLeaseUseCase` (nunca lança). */
export interface SessionLeaseReleaser {
  execute(sessionId: string): Promise<void>;
}

/** Depois destes, o socket local fechou: o worker solta o lease (WROLE-09). */
const RELEASES_LEASE = new Set<EngineMethod>(['disconnectSession', 'logoutSession']);

/**
 * Worker: executa na engine local a chamada vinda do `http` (WROLE-08/09/13). Sem regra de produto.
 * - `rpc`/`command`: exige socket local da sessão, senão `SessionNotOwnedError` (o adapter remoto re-resolve).
 * - `open`/`local`: executa direto; o lease da E2 decide (`SessionLeaseHeldError` volta como erro).
 * - `disconnectSession`/`logoutSession`: solta o lease mesmo se a engine lançar.
 */
export class EngineCommandServer implements IEngineCallHandler {
  constructor(
    private readonly engine: IMessagingEngine,
    private readonly sockets: Pick<ISessionSocketControl, 'listLocalSessionIds'>,
    private readonly releaseLease: SessionLeaseReleaser,
  ) {}

  async handle(call: EngineCall): Promise<unknown> {
    const kind = engineCallKind(call.method);
    const sessionId = engineCallSessionId(call);
    if ((kind === 'rpc' || kind === 'command') && !this.sockets.listLocalSessionIds().includes(sessionId)) {
      throw new SessionNotOwnedError(sessionId);
    }
    if (!RELEASES_LEASE.has(call.method)) return this.invoke(call);
    try {
      return await this.invoke(call);
    } finally {
      await this.releaseLease.execute(sessionId);
    }
  }

  private invoke(call: EngineCall): Promise<unknown> {
    const fn = this.engine[call.method] as (...args: unknown[]) => Promise<unknown>;
    return fn.apply(this.engine, call.args as unknown[]);
  }
}
