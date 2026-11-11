/**
 * Etiquetas efetivas da conta sob o limite do plano: principal (se houver) + as primeiras
 * `limit − 1` vinculadas. Sem repetir (comparação sem caixa; mantém a grafia original) e na
 * ordem recebida. `limit < 1` vale como 1 (a principal sempre fica). Plano rebaixado: o
 * excedente some daqui, sem apagar o que está gravado.
 */
export function effectiveLinkedIdentifiers(
  primary: string | null,
  linked: readonly string[],
  limit: number,
): string[] {
  const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  if (primary) push(primary);
  const linkedMax = max - 1;
  for (const value of linked) {
    if (out.length - (primary ? 1 : 0) >= linkedMax) break;
    if (value) push(value);
  }
  return out;
}
