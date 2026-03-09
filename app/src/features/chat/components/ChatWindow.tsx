import { Box } from '@mui/material';
import type { ChatConversation, ChatMessage } from '../types';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';

interface Props {
  conversation: ChatConversation;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

export function ChatWindow({
  conversation,
  messages,
  onSendMessage,
  detailsOpen,
  onToggleDetails,
}: Props) {
  const isClosed = conversation.status === 'closed';

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
      />

      <MessageList messages={messages} />

      <MessageComposer onSend={onSendMessage} disabled={isClosed} />
    </Box>
  );
}
