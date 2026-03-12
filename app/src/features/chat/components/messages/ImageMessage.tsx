import { useState } from 'react';
import { Box, Typography, Modal, alpha, useTheme } from '@mui/material';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';

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

  if (!mediaUrl) {
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
        component="img"
        src={mediaUrl}
        alt="Imagem"
        onError={() => setError(true)}
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
        <Typography variant="body2" sx={{ color: textColor, fontSize: 13.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {body}
        </Typography>
      )}
      <Modal open={open} onClose={() => setOpen(false)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box
          component="img"
          src={mediaUrl}
          alt="Imagem"
          onClick={() => setOpen(false)}
          sx={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 2, objectFit: 'contain', cursor: 'zoom-out' }}
        />
      </Modal>
    </>
  );
}
