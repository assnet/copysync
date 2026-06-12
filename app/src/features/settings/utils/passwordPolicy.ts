const SPECIAL_CHARS = /[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/`~]/;

export const PASSWORD_REQUIREMENTS = [
  'Mínimo 8 caracteres',
  'Pelo menos 1 letra maiúscula',
  'Pelo menos 1 letra minúscula',
  'Pelo menos 1 número',
  'Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)',
] as const;

export function getUnmetRequirements(plain: string): string[] {
  const failures: string[] = [];

  if (plain.length < 8) failures.push('Mínimo 8 caracteres');
  if (!/[A-Z]/.test(plain)) failures.push('Pelo menos 1 letra maiúscula');
  if (!/[a-z]/.test(plain)) failures.push('Pelo menos 1 letra minúscula');
  if (!/[0-9]/.test(plain)) failures.push('Pelo menos 1 número');
  if (!SPECIAL_CHARS.test(plain)) {
    failures.push('Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~)');
  }

  return failures;
}

export function validatePasswordPolicy(plain: string): string | null {
  const unmet = getUnmetRequirements(plain);
  return unmet.length > 0 ? unmet.join('. ') : null;
}

export function passwordsMatch(a: string, b: string): boolean {
  return a === b;
}
