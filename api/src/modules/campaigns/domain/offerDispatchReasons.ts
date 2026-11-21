/**
 * Envio descartado porque a sessão dona foi excluída (SKIPPED). Diferente de `SESSION_NOT_CONNECTED`
 * (sessão viva fora do ar: espera até 6 h). Ver docs/fila-de-envio.md §2.2.2.
 */
export const SESSION_DELETED_REASON = 'SESSION_DELETED';

/**
 * Envio do monitoramento descartado porque a configuração de origem foi desligada (SKIPPED). Desligar
 * perde a fila (decisão de produto: não guarda fila parada). Ver docs/monitoramento-grupos.md.
 */
export const MONITOR_DISABLED_REASON = 'MONITOR_DISABLED';
