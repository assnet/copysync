import { useState, useCallback, useEffect } from 'react';
import { Box } from '@mui/material';
import type { ChatConversation, ChatMessage, QuotedMessagePreview } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';

interface Props {
  conversation: ChatConversation;
  messages: ChatMessage[];
  onSendMessage: (text: string, quotedMessageId?: string | null) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  loadingMessages?: boolean;
  presence?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  scrollSignal?: { n: number; smooth: boolean };
  onParticipantClick?: (phone: string, name: string) => void;
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
}: Props) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const isClosed = conversation.status === 'closed';

  // Limpa reply ao trocar de conversa
  useEffect(() => { setReplyTo(null); }, [conversation.id]);

  const handleReply = useCallback((msg: ChatMessage) => { setReplyTo(msg); }, []);
  const handleCancelReply = useCallback(() => setReplyTo(null), []);

  const handleSend = useCallback(
    (text: string) => {
      onSendMessage(text, replyTo?.id ?? null);
      setReplyTo(null);
    },
    [onSendMessage, replyTo],
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
    >
      <ChatHeader
        conversation={conversation}
        detailsOpen={detailsOpen}
        onToggleDetails={onToggleDetails}
        presence={presence}
      />

      <MessageList
        messages={messages}
        loading={loadingMessages}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
        scrollSignal={scrollSignal}
        onReply={handleReply}
        onParticipantClick={onParticipantClick}
      />

      <MessageComposer
        onSend={handleSend}
        disabled={isClosed}
        replyTo={replyPreview}
        onCancelReply={handleCancelReply}
      />
    </Box>
  );
}
