import { describe, expect, it } from 'vitest';
import { decideInviteAccess, isFirstAccessInvite, type InviteAccessInput } from './inviteAccess';

const base: InviteAccessInput = {
  hasPassword: false, isSuperAdmin: false, invitedById: null, inviteTenantId: 't1', memberTenantIds: [],
};

describe('decideInviteAccess', () => {
  it('com senha: sempre login', () => {
    expect(decideInviteAccess({ ...base, hasPassword: true })).toBe('LOGIN');
  });
  it('convite do sistema sem senha: define senha mesmo já membro de tenants', () => {
    expect(decideInviteAccess({ ...base, memberTenantIds: ['t1'] })).toBe('SET_PASSWORD');
    expect(decideInviteAccess({ ...base, memberTenantIds: ['t0', 't1'] })).toBe('SET_PASSWORD');
  });
  it('convite de pessoa sem senha: só se não houver outro tenant', () => {
    const p = { ...base, invitedById: 'u9' };
    expect(decideInviteAccess(p)).toBe('SET_PASSWORD');
    expect(decideInviteAccess({ ...p, memberTenantIds: ['t1'] })).toBe('SET_PASSWORD');
    expect(decideInviteAccess({ ...p, memberTenantIds: ['t0'] })).toBe('LOGIN');
    expect(decideInviteAccess({ ...p, isSuperAdmin: true })).toBe('LOGIN');
  });
});

describe('isFirstAccessInvite', () => {
  it('só convite do sistema para conta sem senha', () => {
    expect(isFirstAccessInvite({ invitedById: null, hasPassword: false })).toBe(true);
    expect(isFirstAccessInvite({ invitedById: null, hasPassword: true })).toBe(false);
    expect(isFirstAccessInvite({ invitedById: 'u9', hasPassword: false })).toBe(false);
  });
});
