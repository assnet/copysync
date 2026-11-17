import type { GroupMemberInfo } from '../../../../domain/contracts/IMessagingEngine';

/** Forma mínima do participante que a lib devolve em `groupMetadata` (sem importar tipo dela). */
export interface RawGroupParticipant {
  id?: string | null;
  lid?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  admin?: string | null;
}

/** Usuário do JID em dígitos (`5511…:3@s.whatsapp.net` → `5511…`); null se não for numérico. */
function jidDigits(jid: string | null | undefined): string | null {
  const user = jid?.split('@')[0]?.split(':')[0]?.trim();
  return user && /^\d+$/.test(user) ? user : null;
}

const isLidJid = (jid?: string | null) => !!jid?.endsWith('@lid');
const isPhoneJid = (jid?: string | null) => !!jid?.endsWith('@s.whatsapp.net');

function pickName(p: RawGroupParticipant): string | null {
  for (const v of [p.name, p.notify, p.verifiedName]) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}

/**
 * Participante da lib → membro neutro. Telefone de `phoneNumber` ou do `id` quando é PN;
 * LID de `lid` ou do `id` quando é `@lid`. Participante sem telefone nem LID é descartado.
 */
export function normalizeGroupMembers(participants: readonly RawGroupParticipant[] | null | undefined): GroupMemberInfo[] {
  const out: GroupMemberInfo[] = [];
  for (const p of participants ?? []) {
    const phone = jidDigits(p.phoneNumber) ?? (isPhoneJid(p.id) ? jidDigits(p.id) : null);
    const lid = jidDigits(p.lid) ?? (isLidJid(p.id) ? jidDigits(p.id) : null);
    if (!phone && !lid) continue;
    out.push({ phone, lid, name: pickName(p), isAdmin: p.admin === 'admin' || p.admin === 'superadmin' });
  }
  return out;
}
