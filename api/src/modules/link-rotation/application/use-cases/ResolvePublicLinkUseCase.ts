import { logger } from '../../../../shared/logger/logger';
import type { ILinkClickRepository } from '../../domain/contracts/ILinkClickRepository';
import type { ILinkDomainRepository } from '../../domain/contracts/ILinkDomainRepository';
import type { ILinkRotationPublicStore } from '../../domain/contracts/ILinkRotationPublicStore';
import type { ILinkRotationRepository } from '../../domain/contracts/ILinkRotationRepository';
import type { LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import { LinkRotationStatus, type UserAgentClass } from '../../domain/enums/LinkRotationEnums';
import { classifyUserAgent } from '../../domain/services/classifyUserAgent';
import { hashClickIp } from '../../domain/services/hashClickIp';
import { inviteUrlFromCode } from '../../domain/services/inviteUrl';
import { pickGroup } from '../../domain/services/pickGroup';
import { matchPublicHost } from '../../domain/services/publicHost';

export interface ResolvePublicLinkInput {
  /** Header `Host` cru (porta, caixa e ponto final são normalizados aqui). */
  hostname: string;
  ip: string;
  userAgent: string | null | undefined;
  now?: Date;
}

export type ResolvePublicLinkOutput =
  | { kind: 'redirect'; inviteUrl: string; groupName: string | null; groupAvatarUrl: string | null; title: string }
  | { kind: 'all_full'; title: string }
  | { kind: 'paused'; title: string }
  | { kind: 'bot_preview'; title: string }
  | { kind: 'apex'; landingUrl: string | null }
  | { kind: 'unavailable' }
  | { kind: 'not_found' };

export interface ResolvePublicLinkDeps {
  domains: Pick<ILinkDomainRepository, 'listActive'>;
  rotations: Pick<ILinkRotationRepository, 'findPublicByHost' | 'incrementClick'>;
  clicks: Pick<ILinkClickRepository, 'record'>;
  store: ILinkRotationPublicStore;
  /** `LINK_CLICK_SALT`; null = recurso não configurado no ambiente → `unavailable`. */
  clickSalt: string | null;
  now?: () => Date;
  /** 0 ≤ rng() < 1 (WEIGHTED/RANDOM). */
  rng?: () => number;
  /** Falhas que não bloqueiam a resposta (contagem, aviso de lotado, nomes). */
  warn?: (context: Record<string, unknown>, message: string) => void;
}

/** Mesmo ipHash na mesma rotação dentro da janela não conta de novo. */
export const CLICK_DEDUPE_MS = 10 * 60_000;
/** `allFullNotifiedAt` regravado no máximo 1×/h. */
export const ALL_FULL_NOTIFY_MS = 60 * 60_000;

const PAUSED = new Set<LinkRotationStatus>([LinkRotationStatus.PAUSED, LinkRotationStatus.PAUSED_BY_PLAN]);

/**
 * Resolve `https://<slug>.<domínio>` (LROT-09/10/11/14). Ordem: Host → apex/slug; recurso sem
 * salt ou tenant inativo → unavailable; rotação pausada (manual ou plano) → paused; bot de prévia →
 * bot_preview (não conta, não recebe convite); `pickGroup` null → all_full (marca 1×/h); senão
 * conta o clique e devolve o convite.
 *
 * Dedupe (10 min, mesmo ipHash): não conta de novo, mas o destino é recalculado pelo `pickGroup`
 * (pode cair em outro grupo em BALANCED/RANDOM). Não guardamos o grupo do 1º clique de propósito:
 * o convite é o mesmo tipo de destino e evita estado extra por IP.
 *
 * Contagem (`incrementClick` + `LinkClick`) não é transacional entre si e qualquer falha nela é
 * logada e engolida: o redirect nunca depende de contar.
 */
export class ResolvePublicLinkUseCase {
  constructor(private readonly deps: ResolvePublicLinkDeps) {}

  async execute(input: ResolvePublicLinkInput): Promise<ResolvePublicLinkOutput> {
    const { deps } = this;
    const now = input.now ?? deps.now?.() ?? new Date();

    const match = matchPublicHost(input.hostname, await deps.domains.listActive());
    if (!match) return { kind: 'not_found' };
    if (match.kind === 'apex') return { kind: 'apex', landingUrl: match.domain.landingUrl || null };

    const salt = deps.clickSalt;
    if (!salt) return { kind: 'unavailable' };

    const found = await deps.rotations.findPublicByHost(match.domain.hostname, match.slug);
    if (!found) return { kind: 'not_found' };
    if (!found.tenantActive) return { kind: 'unavailable' };
    const { rotation } = found;

    if (PAUSED.has(rotation.status)) return { kind: 'paused', title: await this.title(rotation, null) };

    const uaClass = classifyUserAgent(input.userAgent);
    if (uaClass === 'bot') return { kind: 'bot_preview', title: await this.title(rotation, null) };

    const group = pickGroup(rotation.groups, rotation.strategy, deps.rng);
    if (!group?.inviteCode) {
      await this.markAllFull(rotation, now);
      return { kind: 'all_full', title: await this.title(rotation, null) };
    }

    await this.countClick(rotation, group.id, input.ip, uaClass, now, salt);
    const labels = await this.labels(rotation, group.conversationId);
    return {
      kind: 'redirect',
      inviteUrl: inviteUrlFromCode(group.inviteCode),
      groupName: labels.groupName,
      groupAvatarUrl: labels.groupAvatarUrl,
      title: rotation.title || labels.sessionName || rotation.slug,
    };
  }

  private async countClick(
    rotation: LinkRotationWithGroups,
    groupId: string,
    ip: string,
    userAgentClass: UserAgentClass,
    now: Date,
    salt: string,
  ): Promise<void> {
    try {
      const ipHash = hashClickIp(ip, now, salt);
      const since = new Date(now.getTime() - CLICK_DEDUPE_MS);
      if (await this.deps.store.hasRecentClick(rotation.tenantId, rotation.id, ipHash, since)) return;
      await this.deps.rotations.incrementClick(rotation.id, groupId, now);
      await this.deps.clicks.record({ tenantId: rotation.tenantId, rotationId: rotation.id, groupId, ipHash, userAgentClass, createdAt: now });
    } catch (err) {
      this.warn({ err: (err as Error)?.name, rotationId: rotation.id, tenantId: rotation.tenantId }, 'link click not counted');
    }
  }

  private async markAllFull(rotation: LinkRotationWithGroups, now: Date): Promise<void> {
    const staleBefore = new Date(now.getTime() - ALL_FULL_NOTIFY_MS);
    // Atalho em memória; a condição real (corrida entre requisições) fica no UPDATE condicional.
    if (rotation.allFullNotifiedAt && rotation.allFullNotifiedAt >= staleBefore) return;
    try {
      await this.deps.store.markAllFullNotified(rotation.tenantId, rotation.id, now, staleBefore);
    } catch (err) {
      this.warn({ err: (err as Error)?.name, rotationId: rotation.id, tenantId: rotation.tenantId }, 'link all-full mark failed');
    }
  }

  private async labels(rotation: LinkRotationWithGroups, conversationId: string | null) {
    try {
      return await this.deps.store.findLabels(rotation.tenantId, rotation.sessionId, conversationId);
    } catch (err) {
      this.warn({ err: (err as Error)?.name, rotationId: rotation.id, tenantId: rotation.tenantId }, 'link labels not loaded');
      return { sessionName: null, groupName: null, groupAvatarUrl: null };
    }
  }

  /** Título da página: `title` da rotação → nome da sessão → slug. */
  private async title(rotation: LinkRotationWithGroups, conversationId: string | null): Promise<string> {
    if (rotation.title) return rotation.title;
    return (await this.labels(rotation, conversationId)).sessionName || rotation.slug;
  }

  private warn(context: Record<string, unknown>, message: string): void {
    (this.deps.warn ?? ((c, m) => logger.warn(c, m)))(context, message);
  }
}
