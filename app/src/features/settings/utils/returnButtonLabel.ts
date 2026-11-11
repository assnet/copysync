import { settingsStrings } from '../strings';

const t = settingsStrings.affiliate;

/** Rótulo do botão de voltar: "Voltar ao monitoramento" só quando o destino é o monitoramento. */
export function returnButtonLabel(returnTo: string): string {
  const path = returnTo.split(/[?#]/)[0];
  return path === '/monitoring' || path.startsWith('/monitoring/') ? t.backToMonitoring : t.back;
}
