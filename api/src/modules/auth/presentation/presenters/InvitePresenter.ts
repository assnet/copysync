export interface InviteInfoView {
  email: string;
  tenantName: string;
  role: string;
  expiresAt: Date;
  hasPassword: boolean;
  requiresLogin: boolean;
  /** Convite do sistema para conta sem senha (primeiro acesso de quem comprou). */
  firstAccess: boolean;
}

/** Corpo de `GET /auth/invites/:token`. `firstAccess` é aditivo: cliente antigo ignora. */
export const InvitePresenter = {
  toInfoResponse(v: InviteInfoView) {
    return {
      email: v.email,
      tenantName: v.tenantName,
      role: v.role,
      expiresAt: v.expiresAt.toISOString(),
      requiresPassword: !v.hasPassword,
      requiresLogin: v.requiresLogin,
      firstAccess: v.firstAccess,
    };
  },
};
