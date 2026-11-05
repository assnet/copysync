import type { IMessagingEngine } from '../../domain/contracts/IMessagingEngine';
import type { ISessionSocketControl } from '../../domain/contracts/ISessionSocketControl';
import { SessionNotOwnedError } from '../../../../shared/errors/internal/SessionErrors';
import { engineCallKind, engineCallSessionId, type EngineCall, type EngineCallOf, type EngineMethod } from './engineCallPlan';
import type { IEngineCallHandler } from './ports';
import { isStagedMediaKey, type IOutboundMediaTransfer } from './outboundMediaTransfer';

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
 * - `sendMediaMessage` com chave do storage: baixa, envia e apaga tmp e chave em `finally` (WROLE-11).
 */
export class EngineCommandServer implements IEngineCallHandler {
  constructor(
    private readonly engine: IMessagingEngine,
    private readonly sockets: Pick<ISessionSocketControl, 'listLocalSessionIds'>,
    private readonly releaseLease: SessionLeaseReleaser,
    private readonly mediaTransfer: Pick<IOutboundMediaTransfer, 'fetch' | 'discard'>,
  ) {}

  async handle(call: EngineCall): Promise<unknown> {
    const kind = engineCallKind(call.method);
    const sessionId = engineCallSessionId(call);
    if ((kind === 'rpc' || kind === 'command') && !this.sockets.listLocalSessionIds().includes(sessionId)) {
      throw new SessionNotOwnedError(sessionId);
    }
    if (call.method === 'sendMediaMessage') return this.sendStagedMedia(call);
    if (!RELEASES_LEASE.has(call.method)) return this.invoke(call);
    try {
      return await this.invoke(call);
    } finally {
      await this.releaseLease.execute(sessionId);
    }
  }

  private async sendStagedMedia(call: EngineCallOf<'sendMediaMessage'>): Promise<unknown> {
    const [input] = call.args;
    const key = input.media.filePath;
    if (!isStagedMediaKey(key)) return this.invoke(call);
    try {
      const local = await this.mediaTransfer.fetch(key);
      try {
        return await this.engine.sendMediaMessage({ ...input, media: { ...input.media, filePath: local.filePath } });
      } finally {
        await local.release();
      }
    } finally {
      await this.mediaTransfer.discard(key);
    }
  }

  private invoke(call: EngineCall): Promise<unknown> {
    const fn = this.engine[call.method] as (...args: unknown[]) => Promise<unknown>;
    return fn.apply(this.engine, call.args as unknown[]);
  }
}
