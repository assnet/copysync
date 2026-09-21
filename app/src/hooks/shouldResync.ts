/** Por que o painel voltou a ter contato com o servidor. */
export type ResyncReason = 'reconnect' | 'tab-visible';

export interface ShouldResyncInput {
  reason: ResyncReason;
  /** Quanto tempo o painel ficou sem receber eventos, em milissegundos. */
  awayMs: number;
  /** Instante do último resync, ou null se nunca houve. */
  lastResyncAt: number | null;
  now: number;
}

/**
 * Janela mínima de afastamento por motivo.
 *
 * Reconexão usa janela curta porque houve perda real de frames: o socket caiu e nada
 * é reenviado. Retomada de aba usa janela longa porque alternar de janela por alguns
 * segundos não perde nada — com janela curta, todo alt-tab viraria uma requisição, o
 * que é polling com outro nome.
 */
const JANELA_MS: Record<ResyncReason, number> = {
  'reconnect': 5_000,
  'tab-visible': 60_000,
};

/** Intervalo mínimo entre dois resyncs, independente do motivo. */
const DEBOUNCE_MS = 30_000;

/**
 * Decide se vale recarregar a lista de conversas.
 *
 * Função pura: o hook cuida dos eventos do navegador, a decisão mora aqui e é testável
 * sem WebSocket.
 */
export function shouldResync({ reason, awayMs, lastResyncAt, now }: ShouldResyncInput): boolean {
  if (awayMs < JANELA_MS[reason]) return false;
  if (lastResyncAt !== null && now - lastResyncAt < DEBOUNCE_MS) return false;
  return true;
}
