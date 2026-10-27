import type { ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import { RETRYABLE_REASONS, type CapturedOfferReason } from '../../domain/entities/CapturedOffer';
import { CapturedOfferNotFoundError, CapturedOfferNotRetryableError } from '../../../../shared/errors/internal/GroupMonitorErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';
import { toCapturedOfferDto, type CapturedOfferDTO } from '../dtos/GroupMonitorDTO';

export const CAPTURED_PAGE_SIZE = 20;

export interface CapturedOffersDeps {
  captured: ICapturedOfferRepository;
  monitors: IGroupMonitorRepository;
}

/** Capturas da sessão, mais recentes primeiro. Página definida pelo servidor (cursor assinado). */
export class ListCapturedOffersUseCase {
  constructor(private readonly deps: CapturedOffersDeps) {}

  async execute(input: { tenantId: string; sessionId: string; cursor?: string }): Promise<{ items: CapturedOfferDTO[]; nextCursor: string | null }> {
    const { tenantId, sessionId } = input;
    if (!(await this.deps.monitors.sessionExists(tenantId, sessionId))) throw new NotFoundError('Session', sessionId);
    const scope = `captured-offers:${tenantId}:${sessionId}`;
    const offset = readCursor(input.cursor, scope) ?? 0;
    // Um a mais para saber se há próxima página
    const rows = await this.deps.captured.list(tenantId, sessionId, offset, CAPTURED_PAGE_SIZE + 1);
    const items = rows.slice(0, CAPTURED_PAGE_SIZE).map(toCapturedOfferDto);
    return { items, nextCursor: rows.length > CAPTURED_PAGE_SIZE ? createCursor(scope, offset + CAPTURED_PAGE_SIZE) : null };
  }
}

/** SKIPPED/FAILED recuperável → PENDING: o worker processa de novo com a configuração atual. */
export class RetryCapturedOfferUseCase {
  constructor(private readonly deps: CapturedOffersDeps) {}

  async execute(input: { tenantId: string; id: string }): Promise<CapturedOfferDTO> {
    const current = await this.deps.captured.findById(input.tenantId, input.id);
    if (!current) throw new CapturedOfferNotFoundError(input.id);
    const retryable = (current.status === 'SKIPPED' || current.status === 'FAILED')
      && current.reason != null && RETRYABLE_REASONS.has(current.reason as CapturedOfferReason);
    if (!retryable || !(await this.deps.captured.resetForRetry(input.tenantId, input.id))) {
      throw new CapturedOfferNotRetryableError(input.id);
    }
    return toCapturedOfferDto((await this.deps.captured.findById(input.tenantId, input.id))!);
  }
}
