import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogActions, Box, Typography, Stepper, Step, StepLabel, StepConnector,
  IconButton, Tooltip, useMediaQuery, useTheme, type StepIconProps,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';
import {
  REDUCED_MOTION, STEP_IN_EASING, brand, brandRing, brandWash, onBrand, stepIn,
} from '../sessionWizardStyle';
import { CHANNEL_ICON } from './SessionChannelChip';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Canal da sessão: dá cor e logo ao cabeçalho e ao indicador de passos. */
  channel: SessionChannel;
  title: ReactNode;
  /** Linha abaixo do título; padrão "Passo n de N" quando há `steps`. */
  subtitle?: ReactNode;
  /** Sem `steps`, a casca não mostra o indicador de passos (ex.: conectar sessão existente). */
  steps?: readonly string[];
  step?: number;
  /** Trava o fechar enquanto uma ação roda. */
  closeDisabled?: boolean;
  children: ReactNode;
  /** Ação secundária à esquerda, principal (`contained`) à direita; uma ação só fica à direita. */
  /** Rodapé; `null` omite a barra (passo cujo painel já tem as ações). */
  actions: ReactNode;
}

const t = sessionStrings.wizard;

/** Ícone de passo 28px: feito (cheio + check), ativo (anel + ponto), pendente (número). */
function makeStepIcon(channel: SessionChannel) {
  return function SessionStepIcon({ active, completed, icon }: StepIconProps) {
    const theme = useTheme();
    const color = brand(theme, channel);
    const base = {
      width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center',
      boxSizing: 'border-box', transition: theme.transitions.create(['background-color', 'border-color', 'box-shadow']),
    } as const;
    if (completed) {
      return (
        <Box sx={{ ...base, bgcolor: color, color: onBrand(theme, channel) }}>
          <AppIcon icon={Check} size="sm" strokeWidth={3} />
        </Box>
      );
    }
    if (active) {
      return (
        <Box sx={{ ...base, border: `2px solid ${color}`, boxShadow: brandRing(theme, channel), bgcolor: 'background.paper' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
        </Box>
      );
    }
    return (
      <Box sx={{ ...base, border: '1.5px solid', borderColor: 'divider', color: 'text.secondary', fontSize: 12, fontWeight: 700 }}>
        {icon}
      </Box>
    );
  };
}

/**
 * Casca dos assistentes de sessão (cabeçalho com a marca do canal, passos, conteúdo, ações).
 * Mesma casca para todo canal e para "conectar sessão existente" (sem `steps`).
 * Tokens em `../sessionWizardStyle.ts`.
 */
export function SessionWizardDialog({
  open, onClose, channel, title, subtitle, steps, step = 0, closeDisabled, children, actions,
}: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const color = brand(theme, channel);
  const StepIcon = useMemo(() => makeStepIcon(channel), [channel]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevStep = useRef(step);
  const last = steps ? steps.length - 1 : 0;
  const caption = subtitle ?? (steps ? t.stepOf(step + 1, steps.length) : null);

  // Troca de passo: foco no título, salvo se o passo novo já focou um campo (autoFocus).
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    const id = requestAnimationFrame(() => {
      if (!contentRef.current?.contains(document.activeElement)) headingRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  return (
    <Dialog
      open={open}
      onClose={closeDisabled ? undefined : onClose}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: '20px' }, overflow: 'hidden' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, pt: 2.5, pb: 2, background: brandWash(theme, channel) }}>
        <Box
          aria-hidden
          sx={{
            width: 40, height: 40, borderRadius: '12px', flexShrink: 0, display: 'grid', placeItems: 'center',
            bgcolor: alpha(color, 0.14), color,
          }}
        >
          <AppIcon icon={CHANNEL_ICON[channel]} size="lg" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            ref={headingRef}
            tabIndex={-1}
            variant="h6"
            component="h1"
            fontWeight={700}
            // Celular: quebra linha em vez de cortar "Nova sessão do Telegram".
            sx={{
              '&:focus': { outline: 'none' },
              lineHeight: 1.3,
              [theme.breakpoints.up('sm')]: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            }}
          >
            {title}
          </Typography>
          {caption && (
            <Typography variant="caption" color="text.secondary" component="div">{caption}</Typography>
          )}
        </Box>
        <Tooltip title={t.close}>
          <span>
            <IconButton onClick={onClose} disabled={closeDisabled} aria-label={t.close}>
              <AppIcon icon={X} size="lg" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {steps && (
        <Box sx={{ px: { xs: 1, sm: 3 }, pb: 2 }}>
          <Stepper
            component="nav"
            aria-label={t.stepperAria}
            activeStep={step}
            alternativeLabel
            connector={
              <StepConnector
                sx={{
                  top: 13,
                  '& .MuiStepConnector-line': {
                    borderTopWidth: 2, borderColor: 'divider', transition: 'border-color .3s',
                  },
                  '&.Mui-active .MuiStepConnector-line, &.Mui-completed .MuiStepConnector-line': { borderColor: color },
                }}
              />
            }
          >
            {steps.map((label, i) => (
              <Step
                key={label}
                completed={step > i || (i === last && step === last)}
                aria-current={i === step ? 'step' : undefined}
              >
                <StepLabel
                  StepIconComponent={StepIcon}
                  sx={{
                    '& .MuiStepLabel-label': { display: { xs: i === step ? 'block' : 'none', sm: 'block' } },
                    // Mesma margem em todo estado: o padrão do MUI varia entre ativo/feito/pendente.
                    '& .MuiStepLabel-label.MuiStepLabel-alternativeLabel': { mt: 1 },
                    '& .MuiStepLabel-label.Mui-active, & .MuiStepLabel-label.Mui-completed': { fontWeight: 600 },
                  }}
                >
                  {label}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}

      <DialogContent ref={contentRef} sx={{ px: 3, py: 3, borderTop: 1, borderColor: 'divider' }}>
        <Box
          key={step}
          sx={{
            animation: `${stepIn} 220ms ${STEP_IN_EASING} both`,
            [REDUCED_MOTION]: { animation: 'none' },
          }}
        >
          {children}
        </Box>
      </DialogContent>

      {actions != null && (
      <DialogActions
        sx={{
          px: 3, py: 2, gap: 1, justifyContent: 'space-between',
          borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper',
          '& > :only-child': { ml: 'auto' },
          '& .MuiButton-contained': { minWidth: 160, py: 1, px: 2.75, fontSize: theme.typography.pxToRem(15) },
          [theme.breakpoints.down('sm')]: {
            position: 'sticky', bottom: 0, zIndex: 1,
            pb: 'calc(16px + env(safe-area-inset-bottom))',
            '& .MuiButton-contained': { flex: 1 },
          },
        }}
      >
        {actions}
      </DialogActions>
      )}
    </Dialog>
  );
}
