import { createContext, useContext } from 'react';

/**
 * Menção no corpo da mensagem: o WhatsApp grava `@<telefone em dígitos>` no texto e o
 * destinatário troca pelo nome na hora de exibir. O painel faz o mesmo: o texto gravado
 * e enviado segue com o telefone; o nome entra só na renderização.
 */
const MENTION_REGEX = /(?:^|\s)@(\d{5,20})(?=\s|$)/g;

/** Telefones (dígitos) marcados com @ no texto — único ponto que decide o que vira menção. */
export function extractMentionPhones(value: string): string[] {
  const phones = new Set<string>();
  let match: RegExpExecArray | null;
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(value))) phones.add(match[1]);
  return [...phones];
}

export type MentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; phone: string; name: string };

/**
 * Divide o texto em trechos comuns e menções com nome conhecido. Menção sem nome no mapa
 * fica como texto (`@<telefone>`), igual ao WhatsApp com contato desconhecido.
 */
export function splitMentions(text: string, names: Readonly<Record<string, string>>): MentionSegment[] {
  const segments: MentionSegment[] = [];
  const regex = /@(\d{5,20})/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const phone = match[1];
    const name = names[phone];
    const start = match.index;
    const end = start + match[0].length;
    const boundaryBefore = start === 0 || /\s/.test(text[start - 1]);
    const boundaryAfter = end === text.length || /\s/.test(text[end]);
    if (!name || !boundaryBefore || !boundaryAfter) continue;
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
    segments.push({ kind: 'mention', phone, name });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  return segments;
}

/** Telefone → nome dos participantes da conversa aberta; vazio fora de grupo. */
export const MentionNamesContext = createContext<Readonly<Record<string, string>>>({});

export function useMentionNames(): Readonly<Record<string, string>> {
  return useContext(MentionNamesContext);
}
