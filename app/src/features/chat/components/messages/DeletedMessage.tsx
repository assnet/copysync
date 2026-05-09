import { Box, Typography, useTheme } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';

interface Props {
  isOut: boolean;
}

export function DeletedMessage({ isOut }: Props) {
  const theme = useTheme();
  const color = isOut ? 'rgba(255,255,255,0.55)' : theme.palette.text.disabled;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <BlockIcon sx={{ fontSize: 14, color }} />
      <Typography
        variant="body2"
        sx={{ color, fontSize: 13, fontStyle: 'italic' }}
      >
        Mensagem apagada
      </Typography>
    </Box>
  );
}
