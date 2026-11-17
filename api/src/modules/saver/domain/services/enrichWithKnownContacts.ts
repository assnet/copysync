import type { SaverKnownContact } from '../contracts/ISaverKnownContactReader';
import { normalizeLid, normalizePhone, type SaverReadMember } from './mergeGroupRead';

/** Telefone plausível (E.164: até 15 dígitos). */
const PHONE = /^\d{8,15}$/;

function usableName(name: string | null | undefined, phone: string | null): string | null {
  const t = name?.trim();
  if (!t) return null;
  // Contato sem nome é gravado com o próprio número: não é nome.
  if (/^[\d\s()+.-]+$/.test(t) || t === phone) return null;
  return t;
}

/**
 * Completa a leitura com o que o MESMO tenant já conhece (função pura):
 * - membro só-LID ganha o telefone do par LID↔telefone visto pelo tenant;
 * - membro sem nome ganha `tenantName` (só para o vínculo do tenant; nunca vai ao contato da plataforma).
 * Nunca troca telefone lido, nunca apaga nada, não altera a entrada.
 */
export function enrichWithKnownContacts(
  members: readonly SaverReadMember[],
  known: readonly SaverKnownContact[],
): SaverReadMember[] {
  if (known.length === 0) return [...members];
  const byLid = new Map<string, SaverKnownContact>();
  const byPhone = new Map<string, SaverKnownContact>();
  for (const k of known) {
    const phone = normalizePhone(k.phone);
    if (!phone || !PHONE.test(phone)) continue;
    const lid = normalizeLid(k.lid);
    const entry = { phone, lid, name: k.name };
    if (lid && lid !== phone && !byLid.has(lid)) byLid.set(lid, entry);
    if (!byPhone.has(phone)) byPhone.set(phone, entry);
  }
  return members.map((m) => {
    const lid = normalizeLid(m.lid);
    const readPhone = normalizePhone(m.phone);
    const match = (!readPhone && lid ? byLid.get(lid) : undefined) ?? (readPhone ? byPhone.get(readPhone) : undefined);
    if (!match) return m;
    const phone = readPhone ?? match.phone;
    const tenantName = m.name?.trim() ? null : usableName(match.name, phone);
    if (phone === m.phone && !tenantName) return m;
    return { ...m, phone, ...(tenantName ? { tenantName } : {}) };
  });
}
