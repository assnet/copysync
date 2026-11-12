import type { InfraCostSettings } from './types';

/** Configuração de exemplo (valores iniciais da spec, COST-02) para os testes. */
export function sampleSettings(): InfraCostSettings {
  return {
    fx: { auto: true, override: null, closingMethod: 'last_business_day' },
    items: [
      {
        key: 'api', label: 'API', category: 'compute', billing: 'fixed', monthlyUsd: 25, quantity: 1,
        storage: { gb: 15, usdPerGb: 0.25 }, renderKey: 'api', planLabel: 'Standard 1 CPU/2 GB', allocation: 'shared', note: null,
      },
      {
        key: 'worker', label: 'Worker', category: 'compute', billing: 'per_instance', monthlyUsd: 25, quantity: 1,
        storage: null, renderKey: 'worker', planLabel: 'Standard 1 CPU/2 GB', allocation: 'shared', note: null,
      },
      {
        key: 'email', label: 'E-mail', category: 'email', billing: 'fixed', monthlyUsd: 23, quantity: 1,
        storage: null, renderKey: null, planLabel: null, allocation: 'shared', note: null,
      },
    ],
    renderPlanPrices: [
      { resourceType: 'service', plan: '0.5c-512mb', monthlyUsd: 7 },
      { resourceType: 'service', plan: '1c-2g', monthlyUsd: 25 },
      { resourceType: 'postgres', plan: '0.5c-1g', monthlyUsd: 19 },
    ],
    aiModelPrices: [{ kind: 'OPENAI', model: 'gpt-x', inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 }],
    workspace: {
      planLabel: 'Hobby', cycleStartDay: 1, includedBandwidthGb: 5, includedBuildMinutes: 500,
      bandwidthUsdPerGb: 0.15, buildUsdPer1000Min: 5, manualBandwidthGb: null, manualBuildMinutes: null,
    },
  };
}
