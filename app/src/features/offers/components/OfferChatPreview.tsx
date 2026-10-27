import { Avatar, Box, Stack, Typography, alpha, useTheme } from '@mui/material';
import { Blurred, useBlur } from '@/features/privacy';
import GroupsIcon from '@mui/icons-material/Groups';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { offerStrings } from '../strings';
import { renderWhatsAppText } from '../utils/whatsappText';

const t = offerStrings.preview;
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

interface Props {
  groupTitle: string | null;
  groupCount: number;
  imageUrl: string | null;
  title: string;
  text: string;
  /** ISO; a hora da bolha. */
  at: string;
}

/**
 * Como a oferta chega no grupo: cabeçalho, foto e bolha de mensagem enviada.
 * Cores derivadas do tema (sucesso translúcido sobre o fundo) para funcionar no claro e no escuro.
 */
export function OfferChatPreview({ groupTitle, groupCount, imageUrl, title, text, at }: Props) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const src = resolveMediaUrl(imageUrl);
  const blurNames = useBlur('offers.groupNames');
  const blurImages = useBlur('offers.productImages');
  const blurText = useBlur('offers.productText');
  const bubbleBg = alpha(theme.palette.success.main, dark ? 0.22 : 0.12);
  const time = timeFmt.format(new Date(at));

  return (
    <Box
      sx={{
        borderRadius: 3,
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        alignItems="center"
        sx={{ px: 1.75, py: 1.25, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
      >
        <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(theme.palette.success.main, 0.18), color: 'success.main' }} aria-hidden>
          <GroupsIcon fontSize="small" />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap><Blurred when={blurNames} inline radius={5}>{groupTitle || t.groupFallback}</Blurred></Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="p">{t.groupMembers(groupCount)}</Typography>
        </Box>
      </Stack>

      <Box
        sx={{
          p: { xs: 1.5, sm: 2 },
          minHeight: 240,
          // Textura discreta de conversa, só com tokens do tema.
          backgroundImage: `radial-gradient(${alpha(theme.palette.text.primary, dark ? 0.06 : 0.05)} 1px, transparent 1px)`,
          backgroundSize: '16px 16px',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <Box
          sx={{
            maxWidth: 360,
            width: '100%',
            // Cor translúcida sobre o papel opaco: a textura do fundo não vaza no texto.
            background: `linear-gradient(${bubbleBg}, ${bubbleBg}), ${theme.palette.background.paper}`,
            borderRadius: 2,
            borderTopRightRadius: 4,
            p: 0.5,
            boxShadow: `0 1px 1px ${alpha(theme.palette.common.black, dark ? 0.4 : 0.08)}`,
          }}
        >
          <Box
            sx={{
              borderRadius: 1.5,
              overflow: 'hidden',
              aspectRatio: '1 / 1',
              bgcolor: src ? 'common.white' : 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {src ? (
              <Box component="img" src={src} alt={t.imageAlt(title || t.noTitle)} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'contain', ...(blurImages && { filter: 'blur(14px)' }) }} />
            ) : (
              <Stack alignItems="center" spacing={1} sx={{ color: 'text.disabled' }}>
                <ImageNotSupportedOutlinedIcon sx={{ fontSize: 40 }} aria-hidden />
                <Typography variant="caption">{t.noImage}</Typography>
              </Stack>
            )}
          </Box>
          <Typography
            variant="body2"
            component="div"
            sx={{ px: 1, pt: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45, color: 'text.primary' }}
          >
            <Blurred when={blurText}>{renderWhatsAppText(text)}</Blurred>
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ px: 1, pb: 0.5, color: 'text.secondary' }}>
            <Typography variant="caption" sx={{ fontSize: 11 }}>{time}</Typography>
            <DoneAllIcon sx={{ fontSize: 16, color: 'info.main' }} aria-hidden />
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
