import { AppError } from '../AppError';

export class TenantSuspendedError extends AppError {
  constructor() {
    super('TENANT_SUSPENDED', 'Tenant is suspended or cancelled', 403);
  }
}

export class UserInactiveError extends AppError {
  constructor() {
    super('USER_INACTIVE', 'User membership is inactive', 403);
  }
}

export class AlreadyMemberError extends AppError {
  constructor() {
    super('ALREADY_MEMBER', 'User is already an active member of this tenant', 409);
  }
}

export class InviteInvalidError extends AppError {
  constructor() {
    super('INVITE_INVALID', 'Invite token is invalid, expired or already used', 404);
  }
}

export class LastAdminError extends AppError {
  constructor() {
    super('LAST_ADMIN', 'Cannot deactivate the last admin of a tenant', 409);
  }
}

export class SlugTakenError extends AppError {
  constructor() {
    super('SLUG_TAKEN', 'Tenant slug is already in use', 409);
  }
}
