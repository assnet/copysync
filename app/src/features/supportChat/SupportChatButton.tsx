import { Box, Tooltip, darken, keyframes, useTheme } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { AppIcon } from '@/components/AppIcon';
import { WhatsAppIcon, brandColor } from '@/components/brandIcons';
import { SUPPORT_CHAT_PATH } from '@/features/platformLinks/links';
import { isSupportChatHidden, isSupportChatRaised } from './routes';
import { supportChatStrings as t } from './strings';

/**
 * Verde do canal escurecido: branco sobre ele passa de 4.5:1 (ícone e rótulo), nos dois temas.
 * O tom vivo da marca (#25D366) dá ~2:1 com branco.
 */
export const SUPPORT_CHAT_SURFACE = darken(brandColor('whatsapp', 'light'), 0.12);

const SIZE = { xs: 52, md: 56 } as const;
const EDGE = { xs: 16, md: 24 } as const;
/** Distância do rodapé quando a tela tem barra de ação presa embaixo (ver `routes.ts`). */
const RAISED = { xs: 132, sm: 88 } as const;
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
/** Só expande para pílula onde há ponteiro com hover e espaço (md+). */
const CAN_EXPAND = '@media (hover: hover) and (min-width: 900px)';

/** Um único anel discreto na entrada (não repete). */
const enterRing = keyframes`
  from { opacity: .45; transform: scale(1); }
  to { opacity: 0; transform: scale(1.35); }
`;

const edge = (px: number, inset: 'bottom' | 'right') => `calc(${px}px + env(safe-area-inset-${inset}, 0px))`;

/**
 * Botão flutuante de suporte (canto inferior direito), logado e deslogado. Link puro para
 * `/redirect/suporte` (conta o clique e leva ao canal): sem auth, sem API.
 */
export function SupportChatButton() {
  const theme = useTheme();
  const { pathname } = useLocation();
  if (isSupportChatHidden(pathname)) return null;

  const raised = isSupportChatRaised(pathname);
  const dark = theme.palette.mode === 'dark';
  const restShadow = dark
    ? '0 0 0 1px rgba(255,255,255,.14), 0 6px 16px rgba(0,0,0,.5)'
    : '0 1px 2px rgba(16,24,40,.12), 0 6px 16px rgba(16,24,40,.18)';
  const hoverShadow = dark
    ? '0 0 0 1px rgba(255,255,255,.2), 0 10px 24px rgba(0,0,0,.6)'
    : '0 2px 4px rgba(16,24,40,.14), 0 10px 24px rgba(16,24,40,.24)';

  return (
    <Tooltip title={t.tooltip} placement="left" arrow enterDelay={400} enterNextDelay={400}>
      <Box
        component="a"
        href={SUPPORT_CHAT_PATH}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t.ariaLabel}
        sx={{
          position: 'fixed',
          right: { xs: edge(EDGE.xs, 'right'), md: edge(EDGE.md, 'right') },
          bottom: raised
            ? { xs: edge(RAISED.xs, 'bottom'), sm: edge(RAISED.sm, 'bottom') }
            : { xs: edge(EDGE.xs, 'bottom'), md: edge(EDGE.md, 'bottom') },
          // Abaixo de AppBar, Drawer, Dialog e Snackbar: nunca cobre sobreposição do painel.
          zIndex: theme.zIndex.speedDial,
          display: 'inline-flex',
          alignItems: 'center',
          height: SIZE,
          minWidth: SIZE,
          borderRadius: 999,
          bgcolor: SUPPORT_CHAT_SURFACE,
          color: theme.palette.common.white,
          textDecoration: 'none',
          boxShadow: restShadow,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          transition: theme.transitions.create(['background-color', 'box-shadow', 'transform'], { duration: 180 }),
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            border: `2px solid ${SUPPORT_CHAT_SURFACE}`,
            opacity: 0,
            pointerEvents: 'none',
            animation: `${enterRing} 900ms ease-out 600ms 1 both`,
          },
          '@media (hover: hover)': {
            '&:hover': { bgcolor: darken(SUPPORT_CHAT_SURFACE, 0.14), boxShadow: hoverShadow, transform: 'translateY(-2px)' },
          },
          '&:active': { transform: 'scale(.97)' },
          '&:focus-visible': {
            outline: `3px solid ${theme.palette.background.default}`,
            boxShadow: `0 0 0 6px ${SUPPORT_CHAT_SURFACE}, ${restShadow}`,
          },
          [CAN_EXPAND]: {
            '&:hover .support-chat-label, &:focus-visible .support-chat-label': { maxWidth: 120, opacity: 1, pr: 2.5 },
          },
          [REDUCED_MOTION]: {
            transition: 'none',
            '&:hover, &:active': { transform: 'none' },
            '&::after': { animation: 'none' },
            '& .support-chat-label': { transition: 'none' },
          },
          '@media print': { display: 'none' },
        }}
      >
        <Box component="span" sx={{ width: SIZE, height: SIZE, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
          <AppIcon icon={WhatsAppIcon} size="lg" />
        </Box>
        <Box
          component="span"
          className="support-chat-label"
          aria-hidden
          sx={{
            maxWidth: 0,
            opacity: 0,
            pr: 0,
            ml: -0.5,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            typography: 'body2',
            fontWeight: 700,
            transition: theme.transitions.create(['max-width', 'opacity', 'padding'], { duration: 200 }),
          }}
        >
          {t.label}
        </Box>
      </Box>
    </Tooltip>
  );
}
