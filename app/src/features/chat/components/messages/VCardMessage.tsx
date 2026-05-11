import { Box, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContactPageOutlinedIcon from '@mui/icons-material/ContactPageOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { formatPhone } from '../../utils';

interface Props {
  body?: string | null;
  textColor: string;
}

function readVCardLine(vcard: string, key: string): string | null {
  const line = vcard
    .split(/\r?\n/)
    .find((currentLine) => currentLine.toLowerCase().startsWith(key.toLowerCase()));

  return line?.split(':').slice(1).join(':').trim() ?? null;
}

function parseVCard(vcard: string | null | undefined): { name: string | null; phone: string | null; rawPhone: string | null } {
  if (!vcard) return { name: null, phone: null, rawPhone: null };

  const hasStructuredVCard = /BEGIN:VCARD/i.test(vcard) || /\nFN[;:]/i.test(vcard) || /\nTEL[^:]*:/i.test(vcard);
  if (!hasStructuredVCard) {
    return { name: vcard.trim() || null, phone: null, rawPhone: null };
  }

  const name = readVCardLine(vcard, 'FN') ?? readVCardLine(vcard, 'N');
  const phoneLine = vcard
    .split(/\r?\n/)
    .find((currentLine) => /^TEL/i.test(currentLine));
  const rawPhone = phoneLine?.split(':').slice(1).join(':').trim() ?? null;
  const phone = rawPhone?.replace(/\D/g, '') ?? null;

  return {
    name: name?.replace(/;/g, ' ').replace(/\s+/g, ' ').trim() ?? null,
    phone,
    rawPhone,
  };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? 'C';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
  return `${first}${second}`.toUpperCase();
}

export function VCardMessage({ body, textColor }: Props) {
  const theme = useTheme();
  const { name, phone, rawPhone } = parseVCard(body);
  const displayName = name ?? 'Contato';
  const initials = getInitials(displayName);
  const formattedPhone = phone ? formatPhone(phone) : rawPhone;
  const waLink = phone ? `https://wa.me/${phone}` : null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: { xs: '100%', sm: 292 },
        maxWidth: '100%',
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05),
        border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
        borderRadius: 2,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          width: '100%',
          p: 1.35,
        }}
      >
        <Box
          sx={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.24 : 0.16),
            color: theme.palette.success.main,
            border: `1px solid ${alpha(theme.palette.success.main, 0.34)}`,
            boxShadow: `0 8px 20px ${alpha(theme.palette.success.main, 0.14)}`,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
          {displayName === 'Contato' ? <PersonOutlineIcon sx={{ fontSize: 23 }} /> : initials}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.65, mb: 0.15 }}>
            <ContactPageOutlinedIcon sx={{ fontSize: 14, color: alpha(textColor, 0.58), flexShrink: 0 }} />
            <Typography variant="caption" sx={{ color: alpha(textColor, 0.58), fontSize: 10.5, fontWeight: 700 }}>
              Contato
            </Typography>
          </Box>
          <Typography
            variant="caption"
            display="block"
            title={displayName}
            sx={{ color: textColor, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {displayName}
          </Typography>
          {formattedPhone && (
            <Typography variant="caption" display="block" sx={{ color: alpha(textColor, 0.66), fontSize: 11 }}>
              {formattedPhone}
            </Typography>
          )}
        </Box>
        {waLink && (
          <Tooltip title="Abrir conversa">
            <IconButton
              component="a"
              href={waLink}
              target="_blank"
              rel="noopener"
              size="small"
              sx={{ width: 30, height: 30, color: alpha(textColor, 0.82), '&:hover': { bgcolor: alpha(textColor, 0.08) } }}
            >
              <ChatBubbleOutlineIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box
        sx={{
          width: '100%',
          px: 1.35,
          py: 0.85,
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.58)}`,
          bgcolor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.08 : 0.045),
        }}
      >
        <Typography variant="caption" sx={{ color: alpha(textColor, 0.64), fontSize: 10.5 }}>
          {formattedPhone ? 'Cartão de contato recebido' : 'Cartão de contato sem telefone'}
        </Typography>
      </Box>
    </Box>
  );
}
