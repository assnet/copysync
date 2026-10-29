import { linkDomainsAdminStrings as s } from './strings';
import type { LinkDomainProbeResult } from './types';

/** Mensagem amigável a partir do código de erro da API (o `apiClient` anexa `code`). */
export function linkDomainErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return (typeof code === 'string' && s.errors[code]) || s.errors.generic;
}

/** Motivo do probe em texto de operador; código HTTP junto quando ajuda a diagnosticar. */
export function probeReasonMessage(result: Pick<LinkDomainProbeResult, 'reason' | 'status'>): string {
  const base = (result.reason && s.probe.reasons[result.reason]) || s.probe.unknownReason;
  return result.status != null ? `${base}${s.probe.statusSuffix(result.status)}` : base;
}
