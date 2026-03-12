import { Box, Typography, alpha, useTheme } from '@mui/material';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';

interface Props {
  mediaUrl?: string | null;
  isOut: boolean;
}

export function StickerMessage({ mediaUrl }: Props) {
  const theme = useTheme();

  if (!mediaUrl) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1.5,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          borderRadius: 1.5,
          color: 'text.secondary',
        }}
      >
        <EmojiEmotionsOutlinedIcon sx={{ fontSize: 24 }} />
        <Typography variant="caption">Sticker</Typography>
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src={mediaUrl}
      alt="Sticker"
      sx={{
        maxWidth: 120,
        maxHeight: 120,
        objectFit: 'contain',
        display: 'block',
        // Stickets ficam sem fundo de bolha — mas mantemos o padding
      }}
    />
  );
}
