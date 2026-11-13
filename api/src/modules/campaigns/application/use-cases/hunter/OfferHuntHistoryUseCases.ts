import type { IOfferHuntRepository } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IOfferHuntRunRepository, OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { OfferHuntFind, OfferHuntRun, OfferHuntRunSummary } from '../../../domain/hunter/OfferHunt';
import { OfferHuntCursorInvalidError, OfferHuntNotFoundError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import { createHuntPageCursor, readHuntPageCursor } from './huntPageCursor';

/** Tamanho da página: decisão do servidor (o painel só devolve o cursor). */
export const OFFER_HUNT_PAGE_SIZE = 20;

export interface OfferHuntPageInput {
  tenantId: string;
  huntId: string;
  /** Opaco, emitido pela página anterior. Ausente = primeira página. */
  cursor?: string;
}

export interface OfferHuntPage<T> {
  items: T[];
  nextCursor: string | null;
}

type Lister<T> = (tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }) => Promise<T[]>;

async function page<T extends { id: string }>(
  hunts: Pick<IOfferHuntRepository, 'findById'>, list: Lister<T>, keyOf: (item: T) => Date, kind: 'runs' | 'finds', input: OfferHuntPageInput,
): Promise<OfferHuntPage<T>> {
  const { tenantId, huntId } = input;
  const scope = `offer-hunt-${kind}:${tenantId}:${huntId}`;
  let after: OfferHuntPageCursor | undefined;
  if (input.cursor) {
    const key = readHuntPageCursor(input.cursor, scope);
    if (!key) throw new OfferHuntCursorInvalidError();
    after = key;
  }
  if (!(await hunts.findById(tenantId, huntId))) throw new OfferHuntNotFoundError();
  const rows = await list(tenantId, huntId, { limit: OFFER_HUNT_PAGE_SIZE + 1, after });
  const items = rows.slice(0, OFFER_HUNT_PAGE_SIZE);
  const last = items[items.length - 1];
  const nextCursor = rows.length > OFFER_HUNT_PAGE_SIZE && last ? createHuntPageCursor(scope, { at: keyOf(last), id: last.id }) : null;
  return { items, nextCursor };
}

/** Histórico de execuções da caçada, mais nova primeiro, cursor keyset assinado. */
export class ListOfferHuntRunsUseCase {
  constructor(private readonly deps: { hunts: Pick<IOfferHuntRepository, 'findById'>; runs: Pick<IOfferHuntRunRepository, 'listByHunt'> }) {}

  execute(input: OfferHuntPageInput): Promise<OfferHuntPage<OfferHuntRunSummary>> {
    return page(this.deps.hunts, (t, h, p) => this.deps.runs.listByHunt(t, h, p), (r) => r.startedAt, 'runs', input);
  }
}

/** Uma execução com o `ranking` (a lista não traz). Outro tenant/caçada → 404 `OFFER_HUNT_NOT_FOUND`. */
export class GetOfferHuntRunUseCase {
  constructor(private readonly deps: { runs: Pick<IOfferHuntRunRepository, 'findById'> }) {}

  async execute(input: { tenantId: string; huntId: string; runId: string }): Promise<OfferHuntRun> {
    const run = await this.deps.runs.findById(input.tenantId, input.huntId, input.runId);
    if (!run) throw new OfferHuntNotFoundError('run');
    return run;
  }
}

/** Achados da caçada, mais novo primeiro, cursor keyset assinado. */
export class ListOfferHuntFindsUseCase {
  constructor(private readonly deps: { hunts: Pick<IOfferHuntRepository, 'findById'>; finds: Pick<IOfferHuntFindRepository, 'listByHunt'> }) {}

  execute(input: OfferHuntPageInput): Promise<OfferHuntPage<OfferHuntFind>> {
    return page(this.deps.hunts, (t, h, p) => this.deps.finds.listByHunt(t, h, p), (f) => f.createdAt, 'finds', input);
  }
}
