import { Box, Typography, alpha, useTheme } from '@mui/material';
import PhoneCallbackOutlinedIcon from '@mui/icons-material/PhoneCallbackOutlined';
import PhoneDisabledOutlinedIcon from '@mui/icons-material/PhoneDisabledOutlined';

interface Props {
  body?: string | null;
  isOut: boolean;
}

export function CallLogMessage({ body }: Props) {
  const theme = useTheme();
  const isMissed = body?.toLowerCase().includes('perdida') || body?.toLowerCase().includes('missed');

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', px: 3, my: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.75,
          borderRadius: 4,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {isMissed ? (
          <PhoneDisabledOutlinedIcon sx={{ fontSize: 14, color: 'error.main' }} />
        ) : (
          <PhoneCallbackOutlinedIcon sx={{ fontSize: 14, color: 'success.main' }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          {body ?? 'Chamada'}
        </Typography>
      </Box>
    </Box>
  );
}
