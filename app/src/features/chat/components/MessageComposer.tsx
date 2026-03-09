import { useState, useRef, type KeyboardEvent } from 'react';
import { Box, TextField, IconButton, Tooltip, Divider, alpha, useTheme } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function MessageComposer({ onSend, disabled }: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <Box>
      <Divider />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1,
          px: 1.5,
          py: 1.25,
          bgcolor: 'background.paper',
        }}
      >
        {/* Attachments */}
        <Box sx={{ display: 'flex', alignItems: 'center', pb: 0.5 }}>
          <Tooltip title="Emoji (em breve)">
            <span>
              <IconButton size="small" disabled sx={{ color: 'text.disabled' }}>
                <EmojiEmotionsOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Anexar (em breve)">
            <span>
              <IconButton size="small" disabled sx={{ color: 'text.disabled' }}>
                <AttachFileOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {/* Input */}
        <TextField
          inputRef={inputRef}
          multiline
          maxRows={4}
          fullWidth
          size="small"
          placeholder="Digite uma mensagem... (Enter para enviar)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 3,
              fontSize: 14,
              bgcolor: alpha(theme.palette.text.primary, 0.04),
              '& fieldset': { border: 'none' },
              '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.06) },
              '&.Mui-focused': {
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                outline: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
              },
            },
          }}
        />

        {/* Send or mic */}
        <Box sx={{ pb: 0.5 }}>
          {hasText ? (
            <Tooltip title="Enviar (Enter)">
              <IconButton
                onClick={handleSend}
                disabled={disabled}
                sx={{
                  bgcolor: 'primary.main',
                  color: '#fff',
                  width: 36,
                  height: 36,
                  '&:hover': { bgcolor: 'primary.dark' },
                  '&:disabled': { bgcolor: 'action.disabledBackground' },
                  transition: 'all 0.15s',
                }}
              >
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Áudio (em breve)">
              <span>
                <IconButton size="small" disabled sx={{ color: 'text.disabled' }}>
                  <MicNoneOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  );
}
