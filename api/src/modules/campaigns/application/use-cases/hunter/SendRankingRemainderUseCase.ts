import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import { AppError } from '../../../../../shared/errors/AppError';
import { OfferHuntAlreadySentError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import { logger } from '../../../../../shared/logger/logger';
import type { SendRankingItemUseCase } from './SendRankingItemUseCase';

const DAY_MS = 86_400_000;

/** Motivo de item pulado: `ALREADY_SENT` (desta execução), `REPEATED` (janela da caçada) ou o código do erro. */
export interface RankingSkip {
  productId: string;
  reason: string;
}

export interface SendRankingRemainderOutput {
  sent: number;
  skipped: RankingSkip[];
}

/**
 * Erros que param o lote: portão (plano, caçador, credencial, aceite, destino) ou loja fora/limitando. Os demais
 * itens dariam o mesmo erro (e a loja seria chamada à toa). Outros erros (produto indisponível etc.) pulam o item.
 */
const STOP_CODES = new Set([
  'PLAN_FEATURE_UNAVAILABLE', 'AFFILIATE_CREDENTIAL_REJECTED', 'AFFILIATE_CREDENTIAL_REQUIRED', 'MARKETPLACE_RISK_NOT_ACCEPTED',
  'OFFER_HUNT_DESTINATION_REQUIRED', 'AFFILIATE_API_UNAVAILABLE', 'AFFILIATE_API_RATE_LIMITED',
]);

export interface SendRankingRemainderDeps {
  items: Pick<SendRankingItemUseCase, 'loadContext' | 'send'>;
  finds: Pick<IOfferHuntFindRepository, 'productIdsByRun' | 'recentProductIds'>;
  now?: () => Date;
}

/**
 * "Enviar todas as não escolhidas" de uma execução (só super admin, a rota cobra). Em sequência, reaproveitando o
 * envio de um item (mesmos portões, sem gastar o teto do dia); pula os já enviados desta execução e os repetidos da
 * janela. Erro de portão: sem nada enviado, o erro sobe; com algo enviado, para e devolve o feito (o item que parou
 * entra em `skipped` com o código). Sem pausa artificial: o espaçamento é da fila do gerador.
 */
export class SendRankingRemainderUseCase {
  constructor(private readonly deps: SendRankingRemainderDeps) {}

  async execute(input: { tenantId: string; huntId: string; runId: string }): Promise<SendRankingRemainderOutput> {
    const now = this.deps.now?.() ?? new Date();
    // Rota só de super admin: sem a janela de 48 h
    const ctx = await this.deps.items.loadContext({ ...input, ignoreAgeLimit: true }, now);
    const { hunt, run } = ctx;
    const inRun = new Set(await this.deps.finds.productIdsByRun(input.tenantId, run.id));
    const out: SendRankingRemainderOutput = { sent: 0, skipped: [] };
    const pending = (run.ranking ?? []).filter((i) => !i.chosen && !inRun.has(i.productId));
    if (pending.length === 0) return out;
    const repeatSince = new Date(now.getTime() - hunt.repeatAfterDays * DAY_MS);
    const repeated = new Set<string>();
    for (const provider of new Set(pending.map((i) => i.provider))) {
      const ids = await this.deps.finds.recentProductIds(input.tenantId, hunt.id, provider, repeatSince, { exceptUndeliveredInRun: run.id });
      for (const id of ids) repeated.add(`${provider}:${id}`);
    }
    for (const item of pending) {
      if (repeated.has(`${item.provider}:${item.productId}`)) {
        out.skipped.push({ productId: item.productId, reason: 'REPEATED' });
        continue;
      }
      try {
        await this.deps.items.send(ctx, item.productId, now);
        out.sent++;
      } catch (err) {
        if (err instanceof OfferHuntAlreadySentError) {
          out.skipped.push({ productId: item.productId, reason: err.meta?.reason === 'REPEATED' ? 'REPEATED' : 'ALREADY_SENT' });
          continue;
        }
        // Erro cru (banco, rede fora da entrega): como portão, para; com algo enviado devolve o feito, sem 500
        const code = err instanceof AppError ? err.code : 'DELIVERY_FAILED';
        if (!(err instanceof AppError) || STOP_CODES.has(code)) {
          if (out.sent === 0) throw err;
          out.skipped.push({ productId: item.productId, reason: code });
          logger.warn({ tenantId: input.tenantId, runId: run.id, code, sent: out.sent }, 'offer hunt ranking send-all stopped');
          return out;
        }
        out.skipped.push({ productId: item.productId, reason: code });
      }
    }
    logger.info({ tenantId: input.tenantId, runId: run.id, sent: out.sent, skipped: out.skipped.length }, 'offer hunt ranking send-all done');
    return out;
  }
}
