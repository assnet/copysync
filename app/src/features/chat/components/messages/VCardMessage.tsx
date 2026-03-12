import { Box, Typography, alpha, useTheme } from '@mui/material';
import ContactPageOutlinedIcon from '@mui/icons-material/ContactPageOutlined';

interface Props {
  body?: string | null;
  textColor: string;
}

function parseVCard(vcard: string | null | undefined): { name: string | null; phone: string | null } {
  if (!vcard) return { name: null, phone: null };
  const nameMatch = vcard.match(/FN[;:](.+)/i);
  const telMatch = vcard.match(/TEL[^:]*:(.+)/i);
  return {
    name: nameMatch?.[1]?.trim() ?? null,
    phone: telMatch?.[1]?.trim().replace(/\D/g, '').slice(-11) ?? null,
  };
}

export function VCardMessage({ body, textColor }: Props) {
  const theme = useTheme();
  const { name, phone } = parseVCard(body);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.25,
        bgcolor: alpha(theme.palette.text.primary, 0.07),
        borderRadius: 1.5,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1,
          bgcolor: alpha(theme.palette.success.main, 0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ContactPageOutlinedIcon sx={{ fontSize: 20, color: 'success.main' }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" display="block" sx={{ color: textColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name ?? body ?? 'Contato'}
        </Typography>
        {phone && (
          <Typography variant="caption" sx={{ color: alpha(textColor, 0.65), fontSize: 10 }}>
            {phone}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
