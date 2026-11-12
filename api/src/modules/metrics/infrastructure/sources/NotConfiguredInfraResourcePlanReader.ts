import type { IInfraResourcePlanReader, InfraRenderUnavailable } from '../../domain/contracts/IInfraResourcePlanReader';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';

const NOT_CONFIGURED: InfraRenderUnavailable = { status: 'unavailable', reason: 'not_configured' };

/** Sem `RENDER_API_KEY` ou sem recurso mapeado: nenhuma chamada sai; o job registra a hora como "sem leitura". */
export class NotConfiguredInfraResourcePlanReader implements IInfraResourcePlanReader {
  configuredKeys(): InfraRenderKey[] {
    return [];
  }

  async readResource() {
    return NOT_CONFIGURED;
  }

  async readBandwidthGb() {
    return NOT_CONFIGURED;
  }

  async readBuildMinutes() {
    return NOT_CONFIGURED;
  }
}
