import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react';
import { Box } from '@mui/material';
import type { MediaUploadConfigDto } from '@/types/media.api.types';
import type { ChatConversation, ChatMessage, QuotedMessagePreview } from '../types';
import { chatStrings } from '../strings';
import { hasFiles } from '../media/dataTransferFiles';
import type { AttachmentOrigin } from '../media/mediaPolicy';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer';
import { AttachmentPreviewPanel, type AttachmentSendItem } from './AttachmentPreviewPanel';
import { DropZoneOverlay } from './DropZoneOverlay';
import { MentionNamesContext } from '../mentions';

const NO_MENTION_NAMES: Readonly<Record<string, string>> = {};

interface AttachmentPreview {
  files: File[];
  origin: AttachmentOrigin;
  /** Texto do campo no momento em que a prévia abriu. */
  initialCaption: string;
}

/**
 * Arrasto de arquivo que nenhuma área aceitou (cabeçalho, conversa encerrada, anexos
 * indisponíveis): sem isto o navegador abre o arquivo na aba e a página se perde. Arrastar
 * texto não passa por aqui.
 */
function rejectUnhandledFileDrag(e: DragEvent<HTMLElement>) {
  if (e.nativeEvent.defaultPrevented || !hasFiles(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
}

interface Props {
  conversation: ChatConversation;
  messages: ChatMessage[];
  onSendMessage: (text: string, quotedMessageId?: string | null, mentions?: string[]) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  loadingMessages?: boolean;
  presence?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  scrollSignal?: { n: number; smooth: boolean };
  onParticipantClick?: (phone: string, name: string) => void;
  /** Avatares dos participantes por telefone, usados nas bolhas de grupo. */
  participantAvatars?: Record<string, string>;
  /** Nomes dos participantes por telefone: `@<telefone>` no texto vira `@Nome`. */
  participantNames?: Record<string, string>;
  /** Volta para a lista — navegação por telas no mobile. */
  onBack?: () => void;
  onToggleSearch?: () => void;
  searchOpen?: boolean;
  highlightMessageId?: string | null;
  /** Reagir (`emoji`) ou remover a própria reação (`null`). */
  onSetReaction?: (message: ChatMessage, emoji: string | null) => void;
  /** Limites de upload; `null` enquanto carrega ou após falha → anexos desabilitados. */
  mediaConfig?: MediaUploadConfigDto | null;
  /** Lote confirmado na prévia, na ordem das miniaturas. A citação vale só para o 1º item. */
  onSendAttachments?: (items: AttachmentSendItem[], quotedMessageId: string | null) => void;
  onCancelUpload?: (message: ChatMessage) => void;
  onRetryMessage?: (message: ChatMessage) => void;
  onDiscardUpload?: (message: ChatMessage) => void;
}

export function ChatWindow({
  conversation,
  messages,
  onSendMessage,
  detailsOpen,
  onToggleDetails,
  loadingMessages = false,
  presence,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  scrollSignal,
  onParticipantClick,
  participantAvatars,
  participantNames,
  onBack,
  onToggleSearch,
  searchOpen,
  highlightMessageId,
  onSetReaction,
  mediaConfig = null,
  onSendAttachments,
  onCancelUpload,
  onRetryMessage,
  onDiscardUpload,
}: Props) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  // Barra de voz na linha do campo: soltar arquivo abriria a prévia por cima da gravação.
  const [voiceBarVisible, setVoiceBarVisible] = useState(false);
  const composerRef = useRef<MessageComposerHandle>(null);
  const isClosed = conversation.status === 'closed';

  // Encerrada vence: reabrir resolve. Sem limites não há como validar o lote antes de subir.
  const attachDisabledReason = isClosed
    ? chatStrings.attachments.conversationClosed
    : !mediaConfig || !onSendAttachments
      ? chatStrings.attachments.unavailable
      : null;
  const canAttach = attachDisabledReason === null;

  // Resposta e prévia pertencem à conversa: trocar de conversa descarta as duas.
  useEffect(() => {
    setReplyTo(null);
    setPreview(null);
  }, [conversation.id]);

  // Conversa encerrada (inclusive por outro operador) fecha a prévia aberta.
  useEffect(() => {
    if (!canAttach) setPreview(null);
  }, [canAttach]);

  const handleReply = useCallback((msg: ChatMessage) => { setReplyTo(msg); }, []);
  const handleCancelReply = useCallback(() => setReplyTo(null), []);

  const handleSend = useCallback(
    (text: string, mentions?: string[]) => {
      onSendMessage(text, replyTo?.id ?? null, mentions);
      setReplyTo(null);
    },
    [onSendMessage, replyTo],
  );

  /**
   * Clipe, colar e soltar. Com a prévia aberta, os arquivos entram no fim do lote com a origem
   * de quem os trouxe: um PDF solto num lote de "Fotos e vídeos" não pode herdar o aviso de
   * conversão. A prévia guarda a origem por item, então os já escolhidos não mudam.
   */
  const handleAttachFiles = useCallback(
    (files: File[], origin: AttachmentOrigin) => {
      if (!canAttach || files.length === 0) return;
      const initialCaption = composerRef.current?.getText() ?? '';
      setPreview((current) =>
        current
          ? { ...current, files: [...current.files, ...files], origin }
          : { files, origin, initialCaption },
      );
    },
    [canAttach],
  );

  const handleDropFiles = useCallback((files: File[]) => handleAttachFiles(files, 'auto'), [handleAttachFiles]);
  const handleClosePreview = useCallback(() => setPreview(null), []);

  const handleSendAttachments = useCallback(
    (items: AttachmentSendItem[]) => {
      setPreview(null);
      if (items.length === 0 || !onSendAttachments) return;
      onSendAttachments(items, replyTo?.id ?? null);
      setReplyTo(null);
      composerRef.current?.clearText();
    },
    [onSendAttachments, replyTo],
  );

  const replyPreview: QuotedMessagePreview | null = replyTo
    ? {
        id:        replyTo.id,
        type:      replyTo.type,
        body:      replyTo.body,
        mediaUrl:  replyTo.mediaUrl,
        direction: replyTo.direction,
        isDeleted: replyTo.isDeleted,
      }
    : null;

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
      }}
      onDragEnter={rejectUnhandledFileDrag}
      onDragOver={rejectUnhandledFileDrag}
      onDrop={rejectUnhandledFileDrag}
    >
      <ChatHeader
        conversation={conversation}
        detailsOpen={detailsOpen}
        onToggleDetails={onToggleDetails}
        onBack={onBack}
        onToggleSearch={onToggleSearch}
        searchOpen={searchOpen}
        presence={presence}
      />

      <DropZoneOverlay disabled={!canAttach || voiceBarVisible} onFiles={handleDropFiles}>
        {/* A prévia cobre lista e campo (o rodapé dela substitui o do campo). `isolation`
            contém o zIndex dela aqui dentro: a área de soltar passa por cima e os painéis
            sobrepostos da página (mobile) continuam acima da conversa. */}
        <Box
          sx={{
            position: 'relative',
            isolation: 'isolate',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <MentionNamesContext.Provider value={participantNames ?? NO_MENTION_NAMES}>
          <MessageList
            messages={messages}
            loading={loadingMessages}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            scrollSignal={scrollSignal}
            participantAvatars={participantAvatars}
            highlightMessageId={highlightMessageId}
            onReply={handleReply}
            onParticipantClick={onParticipantClick}
            onSetReaction={onSetReaction}
            onCancelUpload={onCancelUpload}
            onRetry={onRetryMessage}
            onDiscard={onDiscardUpload}
          />
          </MentionNamesContext.Provider>

          <MessageComposer
            ref={composerRef}
            onSend={handleSend}
            disabled={isClosed}
            replyTo={replyPreview}
            onCancelReply={handleCancelReply}
            onAttachFiles={handleAttachFiles}
            attachDisabledReason={attachDisabledReason}
            onVoiceBarChange={setVoiceBarVisible}
            isGroup={conversation.isGroup}
            conversationId={conversation.id}
          />

          {preview && mediaConfig && (
            <AttachmentPreviewPanel
              files={preview.files}
              origin={preview.origin}
              config={mediaConfig}
              initialCaption={preview.initialCaption}
              onSend={handleSendAttachments}
              onClose={handleClosePreview}
            />
          )}
        </Box>
      </DropZoneOverlay>
    </Box>
  );
}
