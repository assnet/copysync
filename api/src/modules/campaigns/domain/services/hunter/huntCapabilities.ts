// Capacidades por marca do Caçador de Ofertas (design §3b). Puro. Painel e validação só oferecem/aceitam o que
// estiver aqui; a pontuação tira os fatores sem dado na marca.
import type { HuntCapabilities, HuntProvider } from '../../hunter/HuntProvider';
import { MERCADO_LIVRE_HUNT_CAPABILITIES } from './mercadoLivreCapabilities';
import { SHEIN_HUNT_CAPABILITIES } from './sheinCapabilities';

export const HUNT_CAPABILITIES: Readonly<Record<HuntProvider, HuntCapabilities>> = Object.freeze<Record<HuntProvider, HuntCapabilities>>({
  SHEIN: SHEIN_HUNT_CAPABILITIES,
  MERCADO_LIVRE: MERCADO_LIVRE_HUNT_CAPABILITIES,
});

export function huntCapabilities(provider: HuntProvider): HuntCapabilities {
  return HUNT_CAPABILITIES[provider];
}

/** Capacidades sem o RegExp (resposta HTTP e prompt). */
export function huntCapabilitiesView(caps: HuntCapabilities) {
  return {
    provider: caps.provider,
    sorts: [...caps.sorts],
    defaultSort: caps.defaultSort,
    sourceFilters: [...caps.sourceFilters],
    localFilters: [...caps.localFilters],
    commissionModel: caps.commissionModel,
  };
}

/** Host https da foto aceito pela marca (o host ou subdomínio). */
export function isHuntImageHost(caps: Pick<HuntCapabilities, 'imageHosts'>, host: string): boolean {
  const h = host.toLowerCase();
  return caps.imageHosts.some((x) => h === x || h.endsWith(`.${x}`));
}
