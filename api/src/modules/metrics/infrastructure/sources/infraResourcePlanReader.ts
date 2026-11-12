import type { IInfraResourcePlanReader } from '../../domain/contracts/IInfraResourcePlanReader';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';
import { env } from '../../../../shared/config/env';
import { infraCostRenderResources } from '../../../../shared/config/infraCostRenderResources';
import { NotConfiguredInfraResourcePlanReader } from './NotConfiguredInfraResourcePlanReader';
import { RenderInfraResourcePlanReader, type RenderInfraResourcePlanReaderOptions } from './RenderInfraResourcePlanReader';

export interface InfraResourcePlanReaderConfig {
  apiKey?: string;
  resources: ReadonlyMap<InfraRenderKey, string>;
}

/** Render só com chave e ao menos um recurso mapeado; senão nenhuma chamada sai. */
export function createInfraResourcePlanReader(
  config: InfraResourcePlanReaderConfig,
  options: Pick<RenderInfraResourcePlanReaderOptions, 'baseUrl' | 'timeoutMs' | 'fetchFn'> = {},
): IInfraResourcePlanReader {
  if (!config.apiKey || config.resources.size === 0) return new NotConfiguredInfraResourcePlanReader();
  return new RenderInfraResourcePlanReader({ ...options, apiKey: config.apiKey, resources: config.resources });
}

/** Leitor do processo, montado na composição do job (só no `worker`/`all`). */
export function infraResourcePlanReader(): IInfraResourcePlanReader {
  return createInfraResourcePlanReader({ apiKey: env.RENDER_API_KEY, resources: infraCostRenderResources() });
}
