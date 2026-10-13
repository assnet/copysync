/**
 * Troca `@<telefone>` por `@<Nome>` num texto de exibição (prévia da lista, por exemplo).
 *
 * O texto gravado segue sempre com o telefone — formato que o WhatsApp resolve de volta;
 * o nome entra só na leitura. Telefone sem nome no mapa fica como está. Só casa menção
 * delimitada por espaço/início/fim, para não tocar em número colado a outro texto.
 */
const MENTION_REGEX = /(^|\s)@(\d{5,20})(?=\s|$)/g;

export function extractMentionPhonesFromText(text: string): string[] {
  const phones = new Set<string>();
  for (const match of text.matchAll(MENTION_REGEX)) phones.add(match[2]);
  return [...phones];
}

export function resolveMentionNames(text: string, namesByPhone: ReadonlyMap<string, string>): string {
  if (namesByPhone.size === 0 || !text.includes('@')) return text;
  return text.replace(MENTION_REGEX, (whole, lead: string, phone: string) => {
    const name = namesByPhone.get(phone);
    return name ? `${lead}@${name}` : whole;
  });
}
