import { randomBytes } from 'node:crypto';

const MAX_BASE_LENGTH = 40;

/** Slug do tenant provisionado pelo billing: nome em `a-z0-9-` + sufixo aleatório curto (colisão → nova tentativa). */
export function buildTenantSlug(name: string, suffix: string = randomBytes(3).toString('hex')): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return `${base || 'conta'}-${suffix}`;
}

/** Nome do tenant: `name` do payload ou a parte local do e-mail. */
export function tenantNameFrom(name: string | undefined, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return email.split('@')[0]?.trim() || email;
}
