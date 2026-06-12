import type { IUserRepository } from '../../domain/contracts/IUserRepository';
import type { ChangePasswordInputDto } from '../dtos/ChangePasswordInputDto';
import { User } from '../../domain/entities/User';
import { hashPassword } from '../../../../shared/utils/hash';
import { validatePasswordPolicy } from '../../../../shared/utils/passwordPolicy';
import { PasswordMismatchError } from '../../../../shared/errors/internal/AuthErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export class ChangePasswordUseCase {
  constructor(private readonly userRepo: IUserRepository) {}

  async execute(userId: string, input: ChangePasswordInputDto): Promise<void> {
    if (input.newPassword !== input.confirmPassword) {
      throw new PasswordMismatchError();
    }

    validatePasswordPolicy(input.newPassword);

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User', userId);

    const passwordHash = await hashPassword(input.newPassword);

    const updatedUser = new User({
      id: user.id,
      email: user.email,
      passwordHash,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });

    await this.userRepo.update(updatedUser);
  }
}
