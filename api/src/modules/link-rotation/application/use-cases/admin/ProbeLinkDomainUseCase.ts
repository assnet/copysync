import { randomBytes } from 'node:crypto';
import type { ILinkDomainRepository } from '../../../domain/contracts/ILinkDomainRepository';
import { LinkRotationNotConfiguredError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';
import { createProbeToken } from './probeToken';

/**
 * Guarda anti-SSRF do host: mesmo contrato de `DnsAiBaseUrlGuard` (assistants), que o
 * container injeta. `blocked` = algum IP resolvido é privado/loopback/link-local/reservado.
 */
export interface ProbeHostGuard {
  check(url: string): Promise<'ok' | 'blocked' | 'unresolvable'>;
}

export type ProbeFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'status'> & { body?: Response['body'] }>;

export type ProbeFailureReason =
  | 'BLOCKED_ADDRESS'
  | 'UNRESOLVABLE'
  | 'REDIRECT'
  | 'UNEXPECTED_STATUS'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

export interface ProbeLinkDomainResult {
  ok: boolean;
  reason: ProbeFailureReason | null;
  /** Status HTTP recebido (null se não houve resposta). */
  status: number | null;
  probedAt: Date;
}

export interface ProbeLinkDomainDeps {
  /** `LINK_PROBE_SECRET`; ausente = recurso desligado (503). */
  secret: string | undefined;
  guard: ProbeHostGuard;
  fetch?: ProbeFetch;
  now?: () => Date;
  /** 8 caracteres hex do subdomínio `probe-<rand>`. */
  randomHex?: () => string;
  timeoutMs?: number;
}

export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Confere que DNS wildcard + certificado + roteamento por Host chegam à API: chama
 * `https://probe-<rand>.<hostname>/.well-known/link-rotation?token=…` e espera 204.
 *
 * Anti-SSRF: só recebe o `id`; o hostname vem SEMPRE do registro salvo (validado no cadastro).
 * Antes do `fetch` a guarda recusa IP não público; `redirect: 'manual'` impede saltar para
 * outro host, `credentials: 'omit'` e sem cookies/headers de auth. Sobra a janela TOCTOU entre
 * a consulta DNS e a do `fetch` (mesmo trade-off do `DnsAiBaseUrlGuard`).
 */
export class ProbeLinkDomainUseCase {
  private readonly fetchFn: ProbeFetch;
  private readonly now: () => Date;
  private readonly randomHex: () => string;
  private readonly timeoutMs: number;

  constructor(
    private readonly domains: ILinkDomainRepository,
    private readonly deps: ProbeLinkDomainDeps,
  ) {
    this.fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
    this.now = deps.now ?? (() => new Date());
    this.randomHex = deps.randomHex ?? (() => randomBytes(4).toString('hex'));
    this.timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  async execute(input: { id: string }): Promise<ProbeLinkDomainResult> {
    const secret = this.deps.secret;
    if (!secret) throw new LinkRotationNotConfiguredError();
    const domain = await this.domains.findById(input.id);
    if (!domain) throw new NotFoundError('LinkDomain', input.id);

    const rand = this.randomHex().toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8).padEnd(8, '0');
    const token = createProbeToken({ domainId: domain.id, hostname: domain.hostname }, this.now(), secret);
    const url = `https://probe-${rand}.${domain.hostname}/.well-known/link-rotation?token=${encodeURIComponent(token)}`;

    const outcome = await this.run(url);
    const probedAt = this.now();
    await this.domains.recordProbe(domain.id, outcome.ok, probedAt);
    return { ...outcome, probedAt };
  }

  private async run(url: string): Promise<Omit<ProbeLinkDomainResult, 'probedAt'>> {
    const verdict = await this.deps.guard.check(url);
    if (verdict === 'blocked') return { ok: false, reason: 'BLOCKED_ADDRESS', status: null };
    if (verdict === 'unresolvable') return { ok: false, reason: 'UNRESOLVABLE', status: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        headers: { accept: '*/*', 'user-agent': 'link-rotation-probe/1' },
        signal: controller.signal,
      });
      void res.body?.cancel().catch(() => undefined);
      if (res.status === 204) return { ok: true, reason: null, status: 204 };
      const reason = res.status >= 300 && res.status < 400 ? 'REDIRECT' : 'UNEXPECTED_STATUS';
      return { ok: false, reason, status: res.status };
    } catch {
      return { ok: false, reason: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', status: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
