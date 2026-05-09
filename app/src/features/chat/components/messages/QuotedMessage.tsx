import { Box, Typography, alpha, useTheme } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';
import ContactPageOutlinedIcon from '@mui/icons-material/ContactPageOutlined';
import type { QuotedMessagePreview } from '../../types';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image:    <ImageOutlinedIcon sx={{ fontSize: 14 }} />,
  audio:    <AudiotrackOutlinedIcon sx={{ fontSize: 14 }} />,
  document: <DescriptionOutlinedIcon sx={{ fontSize: 14 }} />,
  video:    <VideocamOutlinedIcon sx={{ fontSize: 14 }} />,
  location: <LocationOnOutlinedIcon sx={{ fontSize: 14 }} />,
  sticker:  <EmojiEmotionsOutlinedIcon sx={{ fontSize: 14 }} />,
  vcard:    <ContactPageOutlinedIcon sx={{ fontSize: 14 }} />,
};

const TYPE_LABELS: Record<string, string> = {
  text:     '',
  image:    'Imagem',
  audio:    'Áudio',
  document: 'Documento',
  video:    'Vídeo',
  location: 'Localização',
  sticker:  'Sticker',
  vcard:    'Contato',
  call_log: 'Chamada',
};

interface Props {
  quoted: QuotedMessagePreview;
  isOut: boolean;
}

export function QuotedMessage({ quoted, isOut }: Props) {
  const theme = useTheme();
  const accent = isOut ? 'rgba(255,255,255,0.85)' : theme.palette.primary.main;
  const bg = isOut
    ? alpha('#ffffff', 0.12)
    : alpha(theme.palette.primary.main, 0.07);

  const typeLabel = TYPE_LABELS[quoted.type] ?? '';
  const icon = TYPE_ICONS[quoted.type] ?? null;
  const previewText = quoted.isDeleted
    ? 'Mensagem apagada'
    : (quoted.body ?? typeLabel);

  return (
    <Box
      sx={{
        borderLeft: `3px solid ${accent}`,
        pl: 1,
        py: 0.25,
        mb: 0.75,
        bgcolor: bg,
        borderRadius: '0 6px 6px 0',
      }}
    >
      {quoted.isDeleted ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <BlockIcon sx={{ fontSize: 12, color: alpha(isOut ? '#fff' : theme.palette.text.primary, 0.45) }} />
          <Typography variant="caption" sx={{ color: alpha(isOut ? '#fff' : theme.palette.text.primary, 0.45), fontStyle: 'italic', fontSize: 11 }}>
            Mensagem apagada
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
          {typeLabel && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: accent }}>
              {icon}
              <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, color: accent }}>
                {typeLabel}
              </Typography>
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{
              color: isOut ? alpha('#fff', 0.75) : 'text.secondary',
              fontSize: 11,
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 240,
            }}
          >
            {previewText}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
