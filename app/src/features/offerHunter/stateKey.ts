/** Chave persistida do caçador com o dono (tenant + usuário, de `useHunterStateScope`). */
export const hunterStateKey = (base: string, scope: string) => `${base}@${scope}`;
