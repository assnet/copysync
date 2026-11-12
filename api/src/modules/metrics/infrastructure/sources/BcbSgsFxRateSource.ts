import { isIsoDay, isValidFxRate, type FetchedFxRate, type IFxRateSource } from '../../domain/services/fxRate';
import { logger } from '../../../../shared/logger/logger';
import { BCB_FETCH_TIMEOUT_MS, type BcbFxRateSourceOptions } from './BcbPtaxFxRateSource';

/**
 * Fallback da PTAX (COST-06a): série 1 do SGS do BCB (dólar venda), conferida em 2026-11-12:
 * `[{ "data": "DD/MM/AAAA", "valor": "5.5606" }]` (`valor` em texto). URL fixa, sem chave.
 */
export const BCB_SGS_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json';

const SGS_DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const NUMERIC = /^\d+(\.\d+)?$/;

/** Linha do SGS → cotação; `null` se faltar campo ou o valor sair da faixa. */
export function parseSgsResponse(body: unknown): FetchedFxRate | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const row = body[body.length - 1] as { data?: unknown; valor?: unknown };
  const day = typeof row.data === 'string' ? SGS_DAY.exec(row.data) : null;
  const referenceDate = day ? `${day[3]}-${day[2]}-${day[1]}` : null;
  const rate = typeof row.valor === 'string' && NUMERIC.test(row.valor.trim()) ? Number(row.valor) : NaN;
  if (!isValidFxRate(rate) || !isIsoDay(referenceDate)) return null;
  return { rate, referenceDate, source: 'sgs' };
}

export class BcbSgsFxRateSource implements IFxRateSource {
  readonly name = 'sgs' as const;
  private readonly log = logger.child({ module: 'BcbSgsFxRateSource' });

  constructor(private readonly options: Omit<BcbFxRateSourceOptions, 'now'> = {}) {}

  async fetchLatest(signal?: AbortSignal): Promise<FetchedFxRate | null> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? BCB_FETCH_TIMEOUT_MS);
    try {
      const response = await (this.options.fetchFn ?? fetch)(BCB_SGS_URL, {
        headers: { accept: 'application/json' },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      if (!response.ok) {
        this.log.warn({ status: response.status }, 'SGS: resposta não OK');
        return null;
      }
      const rate = parseSgsResponse(await response.json());
      if (!rate) this.log.warn('SGS: resposta sem cotação válida');
      return rate;
    } catch (err) {
      this.log.warn({ err: (err as Error).name }, 'SGS: falha na busca');
      return null;
    }
  }
}
