import { hashPassword, verifyPassword } from '../../../../shared/utils/hash';
import type { PasswordVerifier } from '../../domain/contracts/ILoginSecurity';

let dummyHash: Promise<string> | null = null;

/**
 * bcrypt de verdade; sem hash (usuário inexistente ou sem senha) compara com um hash fixo do mesmo
 * custo e devolve false: a resposta leva o mesmo tempo e não revela se o e-mail existe.
 */
export const bcryptPasswordVerifier: PasswordVerifier = async (plain, hash) => {
  if (hash) return verifyPassword(plain, hash);
  dummyHash ??= hashPassword(`no-user-${Math.random()}`);
  await verifyPassword(plain, await dummyHash);
  return false;
};
