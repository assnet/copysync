import { apiFetch } from './apiFetch.js';
import { SyncError } from './errors.js';
import { devLog } from '../core/devLog.js';

/**
 * Session resolver — single-flight GET /api/extension/me with TTL cache.
 *
 * Pattern from PulsoSocial: `resolverSessao`/`invalidarSessao`.
 * Cookie auth means the session is in the browser — we just need to
 * validate it periodically and cache the profile.
 */

export interface TenantPermissions {
  id: string;
  name: string;
  status: string;
  permissions: string[];
}

export interface ExtensionProfile {
  user: { id: string; name: string; email: string };
  mlTenantId: string | null;
  tenants: TenantPermissions[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 15 * 1000;

let cached: { profile: ExtensionProfile; fetchedAt: number } | null = null;
let inFlight: Promise<ExtensionProfile> | null = null;

const fetchProfile = async (): Promise<ExtensionProfile> => {
  const profile = await apiFetch<ExtensionProfile>({ path: '/api/extension/me' });
  cached = { profile, fetchedAt: Date.now() };
  return profile;
};

export const resolverSessao = async (): Promise<ExtensionProfile> => {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.profile;
  if (inFlight) return inFlight;
  inFlight = fetchProfile().finally(() => { inFlight = null; });
  return inFlight;
};

export const invalidarSessao = (): void => {
  cached = null;
  devLog('session cache invalidated');
};

export const isAuthenticated = (): boolean =>
  cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

export const hasMlPermission = (profile: ExtensionProfile): boolean => {
  if (!profile.mlTenantId) return false;
  const tenant = profile.tenants.find(t => t.id === profile.mlTenantId);
  return tenant?.permissions.includes('ml.session') ?? false;
};

export const getCachedProfile = (): ExtensionProfile | null => {
  if (!cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
  return cached.profile;
};
