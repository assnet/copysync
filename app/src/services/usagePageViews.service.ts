import { apiClient } from './apiClient';

/**
 * Visita de tela (`POST /usage/page-views`, rota da conta). Chamado por qualquer usuário, por isso fora do serviço
 * admin e fora da fila de leituras de uso. A API grava no máximo uma marca por dia × conta × tela (repetir não soma),
 * limita 60 por minuto por conta (429) e responde 204 sem gravar para super admin. Sem timeout longo: é aviso, não
 * leitura.
 */
export const PAGE_VIEW_TIMEOUT_MS = 5_000;

export const usagePageViewsService = {
  async report(key: string): Promise<void> {
    await apiClient.post('/usage/page-views', { key }, { timeout: PAGE_VIEW_TIMEOUT_MS });
  },
};
