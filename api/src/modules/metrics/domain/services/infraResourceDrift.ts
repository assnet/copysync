/** Campo do cadastro que pode divergir do lido na Render (`config_drift`). */
export type InfraResourceDriftField = 'plan' | 'instances' | 'diskGb';

/** Campos lidos que diferem do cadastro (`config_drift`). `null`/`undefined` em qualquer lado não compara. */
export function infraResourceDriftFields(
  reading: { plan: string | null; instances: number | null; diskGb: number | null },
  expected: { plan?: string | null; instances?: number | null; diskGb?: number | null },
): InfraResourceDriftField[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out: InfraResourceDriftField[] = [];
  if (reading.plan != null && expected.plan != null && norm(reading.plan) !== norm(expected.plan)) out.push('plan');
  if (reading.instances != null && expected.instances != null && reading.instances !== expected.instances) out.push('instances');
  if (reading.diskGb != null && expected.diskGb != null && reading.diskGb !== expected.diskGb) out.push('diskGb');
  return out;
}
