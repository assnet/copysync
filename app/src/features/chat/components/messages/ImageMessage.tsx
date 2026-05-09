import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, Modal, alpha, useTheme } from '@mui/material';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import { RichMessageText } from './RichMessageText';

interface Props {
  mediaUrl?: string | null;
  body?: string | null;
  isOut: boolean;
  textColor: string;
}

export function ImageMessage({ mediaUrl, body, textColor }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    setError(false);
    setRetryNonce(0);
    retriedRef.current = false;
  }, [mediaUrl]);

  const resolvedMediaUrl = useMemo(() => {
    if (!mediaUrl) return null;
    if (retryNonce === 0) return mediaUrl;
    const separator = mediaUrl.includes('?') ? '&' : '?';
    return `${mediaUrl}${separator}retry=${retryNonce}`;
  }, [mediaUrl, retryNonce]);

  const handleError = () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      window.setTimeout(() => setRetryNonce((current) => current + 1), 700);
      return;
    }
    setError(true);
  };

  if (!resolvedMediaUrl) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          mb: body ? 1 : 0,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          borderRadius: 1.5,
          color: 'text.secondary',
        }}
      >
        <ImageOutlinedIcon sx={{ fontSize: 24 }} />
        <Typography variant="caption">Imagem</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box
        key={resolvedMediaUrl}
        component="img"
        src={resolvedMediaUrl}
        alt="Imagem"
        onError={handleError}
        onClick={() => !error && setOpen(true)}
        sx={{
          display: error ? 'none' : 'block',
          maxWidth: '100%',
          maxHeight: 220,
          borderRadius: 1.5,
          objectFit: 'cover',
          mb: body ? 1 : 0,
          cursor: 'pointer',
          '&:hover': { opacity: 0.9 },
        }}
      />
      {error && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            mb: body ? 1 : 0,
            bgcolor: alpha(theme.palette.text.primary, 0.06),
            borderRadius: 1.5,
            color: 'text.secondary',
          }}
        >
          <BrokenImageOutlinedIcon sx={{ fontSize: 24 }} />
          <Typography variant="caption">Imagem não disponível</Typography>
        </Box>
      )}
      {body && (
        <RichMessageText text={body} textColor={textColor} />
      )}
      <Modal open={open} onClose={() => setOpen(false)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box
          component="img"
          src={resolvedMediaUrl}
          alt="Imagem"
          onClick={() => setOpen(false)}
          sx={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 2, objectFit: 'contain', cursor: 'zoom-out' }}
        />
      </Modal>
    </>
  );
}
