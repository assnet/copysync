import { isIsoDay, isValidFxRate, type FetchedFxRate, type IFxRateSource } from '../../domain/services/fxRate';
import { logger } from '../../../../shared/logger/logger';

/**
 * PTAX de venda do BCB (COST-06a) pela Olinda `CotacaoDolarPeriodo`, conferida em 2026-11-12:
 * `?@i='MM-DD-AAAA'&@f='MM-DD-AAAA'&$format=json&$orderby=dataHoraCotacao desc&$top=1` →
 * `{ value: [{ cotacaoCompra, cotacaoVenda, dataHoraCotacao: 'AAAA-MM-DD HH:MM:SS.ffffff' }] }`
 * (horário de Brasília). Fim de semana/feriado = `value: []`: a janela de 7 dias pega o último boletim.
 * URL fixa no código (sem SSRF), sem chave. Licença ODbL: a tela cita "Banco Central do Brasil (PTAX)".
 */
export const BCB_PTAX_URL =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)';
export const BCB_FETCH_TIMEOUT_MS = 5_000;
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
/** Brasília é UTC−3 fixo (sem horário de verão desde 2019). */
const BRT_OFFSET_MS = 3 * 3_600_000;

export interface BcbFxRateSourceOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Dia de Brasília `daysAgo` dias antes de `now`, no formato `MM-DD-AAAA` da Olinda. */
function olindaDay(now: Date, daysAgo: number): string {
  const d = new Date(now.getTime() - BRT_OFFSET_MS - daysAgo * DAY_MS);
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

export function bcbPtaxUrl(now: Date): string {
  const qs = `@i='${olindaDay(now, WINDOW_DAYS - 1)}'&@f='${olindaDay(now, 0)}'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1`;
  return `${BCB_PTAX_URL}?${qs}`;
}

/** Linha da Olinda → cotação; `null` se faltar campo ou o valor sair da faixa. */
export function parsePtaxResponse(body: unknown): FetchedFxRate | null {
  const rows = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as { cotacaoVenda?: unknown; dataHoraCotacao?: unknown };
  const referenceDate = typeof row.dataHoraCotacao === 'string' ? row.dataHoraCotacao.slice(0, 10) : null;
  if (!isValidFxRate(row.cotacaoVenda) || !isIsoDay(referenceDate)) return null;
  return { rate: row.cotacaoVenda, referenceDate, source: 'ptax' };
}

export class BcbPtaxFxRateSource implements IFxRateSource {
  readonly name = 'ptax' as const;
  private readonly log = logger.child({ module: 'BcbPtaxFxRateSource' });

  constructor(private readonly options: BcbFxRateSourceOptions = {}) {}

  async fetchLatest(signal?: AbortSignal): Promise<FetchedFxRate | null> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? BCB_FETCH_TIMEOUT_MS);
    try {
      const response = await (this.options.fetchFn ?? fetch)(bcbPtaxUrl(this.options.now?.() ?? new Date()), {
        headers: { accept: 'application/json' },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      if (!response.ok) {
        this.log.warn({ status: response.status }, 'PTAX: resposta não OK');
        return null;
      }
      const rate = parsePtaxResponse(await response.json());
      if (!rate) this.log.warn('PTAX: resposta sem cotação válida na janela');
      return rate;
    } catch (err) {
      this.log.warn({ err: (err as Error).name }, 'PTAX: falha na busca');
      return null;
    }
  }
}
