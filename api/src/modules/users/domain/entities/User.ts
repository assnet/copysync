export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string | null;
  passwordSetAt: Date | null;
  mustChangePassword: boolean;
  name: string;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  public readonly id: string;
  public readonly email: string;
  public readonly passwordHash: string | null;
  public readonly passwordSetAt: Date | null;
  public readonly mustChangePassword: boolean;
  public readonly name: string;
  public readonly isSuperAdmin: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.passwordSetAt = props.passwordSetAt;
    this.mustChangePassword = props.mustChangePassword;
    this.name = props.name;
    this.isSuperAdmin = props.isSuperAdmin;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  hasPassword(): boolean {
    return this.passwordHash !== null;
  }
}
