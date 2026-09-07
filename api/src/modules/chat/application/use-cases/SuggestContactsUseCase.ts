import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';

export interface SuggestContactsInput {
  tenantId: string;
  /** Texto digitado: nome ou telefone, parcial. */
  term: string;
  /** Sessão usada para consultar o WhatsApp; sem ela só há sugestão local. */
  sessionId?: string;
}

export interface ContactSuggestionDto {
  phone: string;
  name: string;
  avatarUrl: string | null;
  /** true quando o contato já existe no tenant. */
  known: boolean;
  /**
   * Resultado da checagem no WhatsApp: true tem conta, false não tem,
   * null não foi possível verificar (sessão fora do ar, por exemplo).
   */
  onWhatsApp: boolean | null;
}

const MAX_LOCAL = 8;
/** Só vale consultar o WhatsApp com número plausível — DDI + DDD + linha. */
const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 14;

/**
 * Sugere contatos enquanto o usuário digita, ao iniciar uma conversa.
 *
 * Combina duas fontes: os contatos já conhecidos do tenant (consulta local, barata)
 * e, quando o texto parece um telefone completo que ainda não está entre eles, uma
 * verificação no WhatsApp — assim é possível iniciar conversa com quem nunca
 * escreveu antes, como faz o WhatsApp Web.
 */
export class SuggestContactsUseCase {
  constructor(
    private readonly contactRepo: IChatContactRepository,
    private readonly engine?: IMessagingEngine,
  ) {}

  async execute(input: SuggestContactsInput): Promise<ContactSuggestionDto[]> {
    const term = input.term.trim();
    if (term.length < 3) return [];

    const known = await this.contactRepo.search(term, input.tenantId, MAX_LOCAL);
    const suggestions: ContactSuggestionDto[] = known.map((contact) => ({
      phone: contact.phone,
      name: contact.name,
      avatarUrl: contact.avatarUrl,
      known: true,
      onWhatsApp: null,
    }));

    const digits = term.replace(/\D/g, '');
    const looksLikePhone = digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
    const alreadyListed = suggestions.some((s) => s.phone === digits);

    if (!looksLikePhone || alreadyListed || !this.engine || !input.sessionId) {
      return suggestions;
    }

    const exists = await this.engine.checkNumberExists(input.sessionId, digits);
    if (exists === false) return suggestions;

    // Número desconhecido que tem (ou pode ter) conta: entra no topo, como destino novo.
    const avatarUrl = exists
      ? await this.engine.fetchProfilePicture(input.sessionId, digits, false).catch(() => null)
      : null;

    return [
      { phone: digits, name: digits, avatarUrl, known: false, onWhatsApp: exists },
      ...suggestions,
    ];
  }
}
