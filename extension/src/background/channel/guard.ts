import type { ChannelError, OpName } from '../../contract/channel.js';
import { resolverSessao, hasMlPermission, type ExtensionProfile } from '../sessionResolver.js';
import { SyncError } from '../errors.js';

/**
 * Channel guard — checks session and permissions before handling an op.
 *
 * Guard codes (same as PulsoSocial):
 * - `NEEDS_LOGIN`: no session cookie / not authenticated
 * - `AUTH`: session invalid or expired
 * - `FORBIDDEN` + reason: authenticated but missing permission
 *   - `MEMBERSHIP`: not a member of the ML tenant
 *   - `TENANT`: tenant inactive
 *   - `PLAN`: missing `marketplace_extension` entitlement
 */

const PUBLIC_OPS: ReadonlySet<string> = new Set<OpName>(['handshake', 'bridge.identify']);
const ML_OPS: ReadonlySet<string> = new Set<OpName>(['ml.status', 'ml.syncSession']);

export interface GuardResult {
  profile: ExtensionProfile;
}

export const checkGuard = async (op: string): Promise<GuardResult | ChannelError> => {
  if (PUBLIC_OPS.has(op)) {
    try {
      const profile = await resolverSessao();
      return { profile };
    } catch {
      return { profile: { user: { id: '', name: '', email: '' }, mlTenantId: null, tenants: [] } } as GuardResult;
    }
  }

  let profile: ExtensionProfile;
  try {
    profile = await resolverSessao();
  } catch (error) {
    if (error instanceof SyncError && error.code === 'session_expired') {
      return { code: 'NEEDS_LOGIN' };
    }
    return { code: 'AUTH' };
  }

  if (!profile.user.id) return { code: 'NEEDS_LOGIN' };

  if (ML_OPS.has(op) || op === 'session.changed') {
    if (!profile.mlTenantId) {
      return { code: 'FORBIDDEN', reason: 'MEMBERSHIP' };
    }
    const tenant = profile.tenants.find(t => t.id === profile.mlTenantId);
    if (!tenant || tenant.status !== 'ACTIVE') {
      return { code: 'FORBIDDEN', reason: 'TENANT' };
    }
    if (!hasMlPermission(profile)) {
      return { code: 'FORBIDDEN', reason: 'PLAN' };
    }
  }

  return { profile };
};
