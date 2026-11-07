import type { SendEmailInput } from '../../domain/contracts/IEmailSender';

/** Templates que a central aceita desta aplicação (`POST /integrations/email/send`). */
export type HubEmailTemplate = 'SET_PASSWORD' | 'TEAM_INVITE' | 'SESSION_DISCONNECTED' | 'LOGIN_VERIFICATION';
export type HubEmailVar = string | number | boolean;

export interface HubEmailBody {
  template: HubEmailTemplate;
  to: string;
  locale: string;
  vars: Record<string, HubEmailVar>;
}

/**
 * Allowlist de vars por template, igual à da central (chave fora dela = 400 lá). Marca, suporte e
 * links do painel são chaves de sistema da central: nunca enviadas daqui.
 */
const VAR_ALLOWLIST: Record<HubEmailTemplate, readonly string[]> = {
  SET_PASSWORD: ['name', 'setPasswordUrl', 'expiresInHours'],
  TEAM_INVITE: ['name', 'inviterName', 'workspaceName', 'inviteUrl', 'expiresInHours'],
  SESSION_DISCONNECTED: ['name', 'sessionName', 'disconnectedAt', 'reconnectUrl'],
  // Código do login suspeito (docs/seguranca-login.md): `code` sempre string de 6 dígitos.
  LOGIN_VERIFICATION: ['code', 'expiresInMinutes', 'name'],
};

/** Template interno (`IEmailSender.send`) → template da central + renomeação das chaves de `data`. */
const INTERNAL_TEMPLATES: Record<string, { template: HubEmailTemplate; rename: Record<string, string> }> = {
  SET_PASSWORD: { template: 'SET_PASSWORD', rename: { link: 'setPasswordUrl' } },
  TEAM_INVITE: { template: 'TEAM_INVITE', rename: { link: 'inviteUrl', tenantName: 'workspaceName' } },
  SESSION_DISCONNECTED: { template: 'SESSION_DISCONNECTED', rename: { link: 'reconnectUrl' } },
  LOGIN_VERIFICATION: { template: 'LOGIN_VERIFICATION', rename: {} },
};

/**
 * Idioma padrão do e-mail: o CopySync não guarda idioma por usuário/tenant e o painel nasce em pt-BR.
 * Sem `locale` a central cai em inglês, então sempre enviamos um.
 */
export const DEFAULT_EMAIL_LOCALE = 'pt-BR';

/** Mesmo formato que a central aceita (`pt-BR`, `pt_BR`, `en`, `es`…). */
const LOCALE_FORMAT = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/;

/** Locale do destinatário em tag BCP 47 (`pt_BR` → `pt-BR`); ausente/inválido → `DEFAULT_EMAIL_LOCALE`. */
export function toHubLocale(raw: string | undefined): string {
  const tag = raw?.trim() ?? '';
  return LOCALE_FORMAT.test(tag) ? tag.replace('_', '-') : DEFAULT_EMAIL_LOCALE;
}

/** Vars de link: a central exige URL absoluta https (relativa = 400). */
export const HUB_LINK_VARS: readonly string[] = ['setPasswordUrl', 'inviteUrl', 'reconnectUrl'];

/** `true` se a URL é absoluta com esquema https. */
export function isAbsoluteHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** `expiresAt` ISO → horas inteiras restantes (mín. 1); inválido = ausente. */
function hoursUntil(iso: unknown, nowMs: number): number | undefined {
  if (typeof iso !== 'string') return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(1, Math.round((t - nowMs) / 3_600_000));
}

/** Só string/number/boolean; a central rejeita "<" com 400, então tira "<" e ">" do texto. */
function toVar(raw: unknown): HubEmailVar | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/[<>]/g, '').trim();
  return text === '' ? undefined : text;
}

/** Monta o corpo da central; `null` = template sem equivalente (não envia). Função pura. */
export function toHubEmailBody(input: SendEmailInput, nowMs: number = Date.now()): HubEmailBody | null {
  const spec = INTERNAL_TEMPLATES[input.template];
  if (!spec) return null;
  const allow = new Set(VAR_ALLOWLIST[spec.template]);
  const vars: Record<string, HubEmailVar> = {};

  for (const [key, raw] of Object.entries(input.data)) {
    const name = spec.rename[key] ?? key;
    if (name === 'expiresAt') {
      const hours = hoursUntil(raw, nowMs);
      if (hours !== undefined && allow.has('expiresInHours')) vars.expiresInHours = hours;
      continue;
    }
    if (!allow.has(name)) continue;
    const value = toVar(raw);
    if (value !== undefined) vars[name] = value;
  }

  return { template: spec.template, to: input.to, locale: toHubLocale(input.locale), vars };
}
