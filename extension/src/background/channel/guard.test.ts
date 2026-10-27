import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionProfile } from '../sessionResolver';
import { SyncError } from '../errors';

const mockResolverSessao = vi.fn<[], Promise<ExtensionProfile>>();
const mockHasMlPermission = vi.fn<[ExtensionProfile], boolean>();

vi.mock('../sessionResolver', () => ({
  resolverSessao: (...args: []) => mockResolverSessao(...args),
  hasMlPermission: (p: ExtensionProfile) => mockHasMlPermission(p),
}));

vi.mock('../errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errors')>();
  return actual;
});

const { checkGuard } = await import('./guard');

const makeProfile = (overrides: Partial<ExtensionProfile> = {}): ExtensionProfile => ({
  user: { id: 'u1', name: 'Test', email: 'test@test.com' },
  mlTenantId: 't1',
  tenants: [{ id: 't1', name: 'Tenant', status: 'ACTIVE', permissions: ['ml.session'] }],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkGuard', () => {
  describe('public ops', () => {
    it('handshake passes without auth', async () => {
      mockResolverSessao.mockRejectedValue(new SyncError('session_expired'));
      const result = await checkGuard('handshake');
      expect('profile' in result).toBe(true);
    });

    it('bridge.identify passes without auth', async () => {
      mockResolverSessao.mockRejectedValue(new Error('no session'));
      const result = await checkGuard('bridge.identify');
      expect('profile' in result).toBe(true);
    });
  });

  describe('authenticated ops', () => {
    it('returns NEEDS_LOGIN when session_expired', async () => {
      mockResolverSessao.mockRejectedValue(new SyncError('session_expired'));
      const result = await checkGuard('ml.status');
      expect(result).toEqual({ code: 'NEEDS_LOGIN' });
    });

    it('returns AUTH on unknown error', async () => {
      mockResolverSessao.mockRejectedValue(new Error('network'));
      const result = await checkGuard('ml.status');
      expect(result).toEqual({ code: 'AUTH' });
    });

    it('returns NEEDS_LOGIN when user.id is empty', async () => {
      mockResolverSessao.mockResolvedValue(makeProfile({ user: { id: '', name: '', email: '' } }));
      const result = await checkGuard('ml.status');
      expect(result).toEqual({ code: 'NEEDS_LOGIN' });
    });
  });

  describe('ML ops', () => {
    it('returns FORBIDDEN/MEMBERSHIP without mlTenantId', async () => {
      mockResolverSessao.mockResolvedValue(makeProfile({ mlTenantId: null }));
      const result = await checkGuard('ml.status');
      expect(result).toEqual({ code: 'FORBIDDEN', reason: 'MEMBERSHIP' });
    });

    it('returns FORBIDDEN/TENANT when tenant inactive', async () => {
      mockResolverSessao.mockResolvedValue(makeProfile({
        tenants: [{ id: 't1', name: 'T', status: 'SUSPENDED', permissions: ['ml.session'] }],
      }));
      mockHasMlPermission.mockReturnValue(true);
      const result = await checkGuard('ml.status');
      expect(result).toEqual({ code: 'FORBIDDEN', reason: 'TENANT' });
    });

    it('returns FORBIDDEN/PLAN without permission', async () => {
      mockResolverSessao.mockResolvedValue(makeProfile());
      mockHasMlPermission.mockReturnValue(false);
      const result = await checkGuard('ml.syncSession');
      expect(result).toEqual({ code: 'FORBIDDEN', reason: 'PLAN' });
    });

    it('passes with full permissions', async () => {
      const profile = makeProfile();
      mockResolverSessao.mockResolvedValue(profile);
      mockHasMlPermission.mockReturnValue(true);
      const result = await checkGuard('ml.syncSession');
      expect(result).toEqual({ profile });
    });
  });

  describe('session.changed op', () => {
    it('requires mlTenantId', async () => {
      mockResolverSessao.mockResolvedValue(makeProfile({ mlTenantId: null }));
      const result = await checkGuard('session.changed');
      expect(result).toEqual({ code: 'FORBIDDEN', reason: 'MEMBERSHIP' });
    });
  });
});
