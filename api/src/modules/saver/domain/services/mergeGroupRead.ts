/**
 * Funde uma leitura de membros de grupo com a base de contatos da PLATAFORMA (design.md §4.2;
 * SAVER-13, SAVER-44). Função pura: decide o que gravar; o repositório aplica.
 *
 * Regras:
 * - Identidade: casa por `lid`; senão por `phone`; senão insere. Nunca por nome.
 * - `phone`, `lid` e `name` do contato só passam de vazio para preenchido (nome: valor não vazio sobrescreve).
 *   Leitura sem telefone nunca apaga telefone guardado.
 * - LID conhecido com telefone diferente: o contato guardado fica como está e o telefone novo vira outro
 *   contato (sem `lid`, para não violar a unicidade). O membro passa a apontar para o contato do telefone
 *   lido (telefone é o dado principal; o tenant exporta o número atual).
 * - Telefone conhecido com LID diferente: casa pelo telefone e mantém o LID guardado.
 * - `lid` casa um contato e `phone` outro, sem conflito entre eles → fusão: fica o de `firstSeenAt` mais
 *   antigo, recebe o campo que faltava, nome não vazio mais recente; vínculos migram (repositório).
 * - Vínculo: nome lido (vazio não apaga o anterior), admin, `lastExtractedAt = now`, `lastExtractionId`,
 *   `leftAt` limpo; `firstExtractedAt` preservado. Quem não veio nesta leitura recebe `leftAt`.
 *
 * Ordem de aplicação esperada (T8): fusões (migra vínculos do absorvido, apaga o absorvido) → inserts
 * (`ON CONFLICT` vira update) → updates → vínculos → saídas.
 */

/** Participante lido (forma estrutural de `GroupMemberInfo`, sem importar `messaging`). */
export interface SaverReadMember {
  phone: string | null;
  lid: string | null;
  name: string | null;
  isAdmin: boolean;
}

/** Contato da base que casa com a leitura (só `phone`/`lid` presentes nela). */
export interface BaseContactState {
  id: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Vínculo atual deste grupo (do tenant que extrai). */
export interface GroupMembershipState {
  contactId: string;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: Date;
  lastExtractedAt: Date;
  leftAt: Date | null;
}

export interface MergeGroupReadInput {
  contacts: readonly BaseContactState[];
  memberships: readonly GroupMembershipState[];
  members: readonly SaverReadMember[];
  now: Date;
  extractionId: string;
}

/** Referência a contato: existente (id) ou inserido nesta leitura (posição em `contactInserts`). */
export type ContactRef = { existingId: string } | { newIndex: number };

export interface ContactInsert {
  phone: string | null;
  lid: string | null;
  name: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** Só os campos que mudam; `phone`/`lid`/`name` presentes = preencher (o repositório usa `COALESCE`). */
export interface ContactUpdate {
  id: string;
  phone?: string;
  lid?: string;
  name?: string;
  firstSeenAt?: Date;
  lastSeenAt: Date;
}

export interface ContactMerge {
  survivorId: string;
  absorbedId: string;
}

export interface MembershipUpsert {
  contact: ContactRef;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: Date;
  lastExtractedAt: Date;
  lastExtractionId: string;
  leftAt: null;
  /** `true` se o contato ainda não tinha vínculo com ESTE grupo. */
  isNewInGroup: boolean;
}

export interface MarkLeft {
  contactId: string;
  leftAt: Date;
}

export interface MergeGroupReadResult {
  contactInserts: ContactInsert[];
  contactUpdates: ContactUpdate[];
  contactMerges: ContactMerge[];
  membershipUpserts: MembershipUpsert[];
  markLeft: MarkLeft[];
  /** Participantes distintos aproveitados (sem telefone e sem LID ficam fora). */
  membersRead: number;
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.split('@')[0]!.split(':')[0]!.replace(/\D+/g, '');
  return digits.length > 0 ? digits : null;
}

export function normalizeLid(value: string | null | undefined): string | null {
  if (!value) return null;
  const bare = value.trim().split('@')[0]!.split(':')[0]!.trim();
  return bare.length > 0 ? bare : null;
}

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

interface WorkingContact {
  ref: ContactRef;
  phone: string | null;
  lid: string | null;
  name: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Só para existentes: valores originais (para emitir só o que muda). */
  original: BaseContactState | null;
  absorbed: boolean;
}

function dedupeMembers(members: readonly SaverReadMember[]): SaverReadMember[] {
  const out: SaverReadMember[] = [];
  const byPhone = new Map<string, SaverReadMember>();
  const byLid = new Map<string, SaverReadMember>();
  for (const raw of members) {
    const phone = normalizePhone(raw.phone);
    const lid = normalizeLid(raw.lid);
    if (!phone && !lid) continue;
    const name = normalizeName(raw.name);
    const prev = (lid && byLid.get(lid)) || (phone && byPhone.get(phone)) || null;
    if (prev) {
      if (!prev.phone && phone && !byPhone.has(phone)) {
        prev.phone = phone;
        byPhone.set(phone, prev);
      }
      if (!prev.lid && lid && !byLid.has(lid)) {
        prev.lid = lid;
        byLid.set(lid, prev);
      }
      if (!prev.name && name) prev.name = name;
      prev.isAdmin = prev.isAdmin || raw.isAdmin;
      continue;
    }
    const member: SaverReadMember = { phone, lid, name, isAdmin: raw.isAdmin };
    out.push(member);
    if (phone) byPhone.set(phone, member);
    if (lid) byLid.set(lid, member);
  }
  return out;
}

function refKey(ref: ContactRef): string {
  return 'existingId' in ref ? `e:${ref.existingId}` : `n:${ref.newIndex}`;
}

function olderFirst(a: WorkingContact, b: WorkingContact): [WorkingContact, WorkingContact] {
  const diff = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
  if (diff !== 0) return diff < 0 ? [a, b] : [b, a];
  return refKey(a.ref) <= refKey(b.ref) ? [a, b] : [b, a];
}

export function mergeGroupRead(input: MergeGroupReadInput): MergeGroupReadResult {
  const { now, extractionId } = input;
  const byLid = new Map<string, WorkingContact>();
  const byPhone = new Map<string, WorkingContact>();
  const byId = new Map<string, WorkingContact>();

  for (const c of input.contacts) {
    const w: WorkingContact = {
      ref: { existingId: c.id },
      phone: normalizePhone(c.phone),
      lid: normalizeLid(c.lid),
      name: normalizeName(c.name),
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      original: c,
      absorbed: false,
    };
    byId.set(c.id, w);
    if (w.lid) byLid.set(w.lid, w);
    if (w.phone) byPhone.set(w.phone, w);
  }

  const inserts: WorkingContact[] = [];
  const merges: ContactMerge[] = [];
  /** Contato absorvido → sobrevivente (para herdar o vínculo deste grupo). */
  const absorbedInto = new Map<string, string>();
  const touched = new Set<WorkingContact>();
  const links = new Map<string, { contact: WorkingContact; name: string | null; isAdmin: boolean }>();

  const insert = (phone: string | null, lid: string | null, name: string | null): WorkingContact => {
    const w: WorkingContact = {
      ref: { newIndex: inserts.length },
      phone,
      lid,
      name,
      firstSeenAt: now,
      lastSeenAt: now,
      original: null,
      absorbed: false,
    };
    inserts.push(w);
    if (phone) byPhone.set(phone, w);
    if (lid) byLid.set(lid, w);
    return w;
  };

  const fill = (w: WorkingContact, phone: string | null, lid: string | null, name: string | null): void => {
    if (!w.phone && phone && !byPhone.has(phone)) {
      w.phone = phone;
      byPhone.set(phone, w);
    }
    if (!w.lid && lid && !byLid.has(lid)) {
      w.lid = lid;
      byLid.set(lid, w);
    }
    if (name) w.name = name;
    w.lastSeenAt = now;
    touched.add(w);
  };

  const members = dedupeMembers(input.members);

  for (const m of members) {
    const cL = m.lid ? byLid.get(m.lid) : undefined;
    const cP = m.phone ? byPhone.get(m.phone) : undefined;
    let target: WorkingContact;

    if (cL && cP && cL !== cP) {
      const compatible = (!cL.phone || cL.phone === m.phone) && (!cP.lid || cP.lid === m.lid);
      if (compatible && cL.original && cP.original) {
        const [survivor, absorbed] = olderFirst(cL, cP);
        absorbed.absorbed = true;
        const survivorId = survivor.original!.id;
        const absorbedId = absorbed.original!.id;
        merges.push({ survivorId, absorbedId });
        absorbedInto.set(absorbedId, survivorId);
        // Libera as chaves do absorvido antes de passá-las ao sobrevivente.
        if (absorbed.phone) byPhone.delete(absorbed.phone);
        if (absorbed.lid) byLid.delete(absorbed.lid);
        const inheritedName =
          survivor.name && absorbed.name
            ? absorbed.lastSeenAt.getTime() > survivor.lastSeenAt.getTime()
              ? absorbed.name
              : survivor.name
            : (survivor.name ?? absorbed.name);
        survivor.name = inheritedName;
        if (absorbed.firstSeenAt.getTime() < survivor.firstSeenAt.getTime()) survivor.firstSeenAt = absorbed.firstSeenAt;
        fill(survivor, absorbed.phone, absorbed.lid, null);
        fill(survivor, m.phone, m.lid, m.name);
        target = survivor;
      } else {
        // Conflito real (cada um com outro valor): telefone lido é o dado principal.
        fill(cP, null, null, m.name);
        cL.lastSeenAt = now;
        touched.add(cL);
        target = cP;
      }
    } else if (cL) {
      if (m.phone && cL.phone && cL.phone !== m.phone) {
        // LID conhecido com telefone diferente: guardado fica; telefone novo vira outro contato.
        cL.lastSeenAt = now;
        touched.add(cL);
        target = insert(m.phone, null, m.name);
      } else {
        fill(cL, m.phone, null, m.name);
        target = cL;
      }
    } else if (cP) {
      fill(cP, null, m.lid, m.name);
      target = cP;
    } else {
      target = insert(m.phone, m.lid, m.name);
    }

    const key = refKey(target.ref);
    const prev = links.get(key);
    if (prev) {
      prev.isAdmin = prev.isAdmin || m.isAdmin;
      if (!prev.name && m.name) prev.name = m.name;
    } else {
      links.set(key, { contact: target, name: m.name, isAdmin: m.isAdmin });
    }
  }

  // Vínculos atuais do grupo, já resolvidos para o sobrevivente das fusões.
  const membershipByContact = new Map<string, GroupMembershipState>();
  for (const ms of input.memberships) {
    const id = absorbedInto.get(ms.contactId) ?? ms.contactId;
    const prev = membershipByContact.get(id);
    if (!prev || ms.firstExtractedAt.getTime() < prev.firstExtractedAt.getTime()) {
      membershipByContact.set(id, prev ? { ...ms, name: ms.name ?? prev.name } : ms);
    }
  }

  const membershipUpserts: MembershipUpsert[] = [];
  const linkedIds = new Set<string>();
  for (const link of links.values()) {
    const existingId = 'existingId' in link.contact.ref ? link.contact.ref.existingId : null;
    const current = existingId ? membershipByContact.get(existingId) : undefined;
    if (existingId) linkedIds.add(existingId);
    membershipUpserts.push({
      contact: link.contact.ref,
      name: link.name ?? current?.name ?? null,
      isAdmin: link.isAdmin,
      firstExtractedAt: current?.firstExtractedAt ?? now,
      lastExtractedAt: now,
      lastExtractionId: extractionId,
      leftAt: null,
      isNewInGroup: !current,
    });
  }

  const markLeft: MarkLeft[] = [];
  const absorbedIds = new Set(absorbedInto.keys());
  // Leitura sem membro identificável não prova saída de ninguém (grupo nunca fica vazio de fato).
  for (const ms of members.length === 0 ? [] : input.memberships) {
    if (ms.leftAt || absorbedIds.has(ms.contactId)) continue;
    if (linkedIds.has(ms.contactId)) continue;
    markLeft.push({ contactId: ms.contactId, leftAt: now });
  }

  const contactUpdates: ContactUpdate[] = [];
  for (const w of touched) {
    if (!w.original || w.absorbed) continue;
    const o = w.original;
    const update: ContactUpdate = { id: o.id, lastSeenAt: now };
    if (w.phone && w.phone !== normalizePhone(o.phone)) update.phone = w.phone;
    if (w.lid && w.lid !== normalizeLid(o.lid)) update.lid = w.lid;
    if (w.name && w.name !== normalizeName(o.name)) update.name = w.name;
    if (w.firstSeenAt.getTime() !== o.firstSeenAt.getTime()) update.firstSeenAt = w.firstSeenAt;
    contactUpdates.push(update);
  }

  return {
    contactInserts: inserts.map((w) => ({
      phone: w.phone,
      lid: w.lid,
      name: w.name,
      firstSeenAt: w.firstSeenAt,
      lastSeenAt: w.lastSeenAt,
    })),
    contactUpdates,
    contactMerges: merges,
    membershipUpserts,
    markLeft,
    membersRead: members.length,
  };
}
