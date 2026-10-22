const MASK = '••••';
const VISIBLE = 4;

/** Exibição apenas: '5577981353128' → '••••3128'. Até 4 caracteres, tudo vira máscara. */
export function maskIdentifier(value: string): string {
  const v = value.trim();
  if (v.length <= VISIBLE) return MASK;
  return `${MASK}${v.slice(-VISIBLE)}`;
}
