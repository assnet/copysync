import type { ChatMessage } from '../entities/ChatMessage';
import type { ChatMessageDirection, ChatMessageStatus, ChatMessageType } from '../enums/ChatMessageEnums';

export interface ListMessagesFilter {
  tenantId: string;
  conversationId: string;
  limit?: number;
  before?: string; // ISO date — para paginação por cursor
  /** 'asc' (padrão) exibe do mais antigo; 'desc' do mais recente */
  orderDir?: 'asc' | 'desc';
  /** Busca textual no conteúdo da mensagem, dentro da conversa. */
  search?: string;
}

export interface FindAroundInput {
  tenantId: string;
  conversationId: string;
  /** Mensagem que deve ficar no meio da janela retornada. */
  messageId: string;
  /** Total aproximado de mensagens: metade antes, metade depois. */
  limit: number;
}

export interface ChatMessageCreateData {
  tenantId: string;
  conversationId: string;
  direction: ChatMessageDirection;
  type: ChatMessageType;
  content?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  externalMessageId?: string | null;
  isDeleted?: boolean;
  quotedMessageId?: string | null;
  /** Timestamp real da mensagem; se omitido, usa new Date() */
  sentAt?: Date | null;
  /** Phone do remetente dentro de um grupo */
  fromParticipant?: string | null;
  /** Nome do remetente dentro de um grupo */
  fromParticipantName?: string | null;
  /** Status inicial; se omitido, SENT. Mídia do painel nasce PENDING até o WhatsApp aceitar. */
  status?: ChatMessageStatus;
}

export interface FailPendingInput {
  /** Só mensagens criadas antes deste instante. */
  olderThan: Date;
  /**
   * Ids que ainda estão sendo enviados neste processo e não podem falhar. Como função, é
   * avaliada depois da seleção e logo antes da escrita: poupa também o que entrou na fila
   * durante a leitura (ex.: reenvio de mensagem antiga). Uma lista é uma foto e não cobre isso.
   */
  excludeIds?: readonly string[] | (() => readonly string[]);
}

export interface FailedPendingMessage {
  id: string;
  tenantId: string;
  conversationId: string;
}

export interface IChatMessageRepository {
  findById(id: string, tenantId: string): Promise<ChatMessage | null>;
  findByExternalId(externalId: string, tenantId: string): Promise<ChatMessage | null>;
  findMany(filter: ListMessagesFilter): Promise<ChatMessage[]>;
  /**
   * Janela de mensagens ao redor de uma específica, em ordem cronológica.
   * Usada para saltar da busca até o ponto da conversa onde a mensagem está.
   */
  findAround(input: FindAroundInput): Promise<ChatMessage[]>;
  create(data: ChatMessageCreateData): Promise<ChatMessage>;
  updateStatusByExternalId(
    externalId: string,
    tenantId: string,
    status: ChatMessageStatus,
  ): Promise<ChatMessage | null>;
  /**
   * Troca o status só se o atual estiver em `from` (e grava `sentAt`, se informado).
   * Devolve `null` quando nada mudou: outro processo ou transição já passou por ela
   * (ex.: o `DELIVERED` chegou antes do `SENT` do despacho). Torna retry e recuperação
   * idempotentes.
   */
  transitionStatus(
    id: string,
    tenantId: string,
    from: ChatMessageStatus[],
    to: ChatMessageStatus,
    sentAt?: Date,
  ): Promise<ChatMessage | null>;
  /**
   * Marca como `FAILED` as mensagens `PENDING` criadas antes de `olderThan`, fora de
   * `excludeIds` (consultado entre a seleção e a escrita), e devolve as que mudaram. Varredura do processo (boot e rotina
   * periódica): atravessa todos os tenants por natureza, por isso não recebe `tenantId`
   * — exceção explícita ao AGENTS.md §36.8. Não use em fluxo de requisição.
   */
  failPending(input: FailPendingInput): Promise<FailedPendingMessage[]>;
}
