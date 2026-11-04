import type { ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogActions, Box, Typography, Stepper, Step, StepLabel, IconButton, Tooltip,
  Divider, useMediaQuery, useTheme,
} from '@mui/material';
import { X } from 'lucide-react';
import { AppIcon } from '@/components';
import { sessionStrings } from '../strings';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  steps: readonly string[];
  step: number;
  /** Trava o fechar enquanto uma ação roda. */
  closeDisabled?: boolean;
  children: ReactNode;
  actions: ReactNode;
}

/** Casca dos assistentes de nova sessão (título, passos, conteúdo, ações) — igual para todo canal. */
export function SessionWizardDialog({ open, onClose, title, steps, step, closeDisabled, children, actions }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const last = steps.length - 1;
  const close = sessionStrings.wizard.close;

  return (
    <Dialog open={open} onClose={closeDisabled ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 2.5, pb: 1 }}>
        <Typography variant="h6" component="h1" fontWeight={700}>{title}</Typography>
        <Tooltip title={close}>
          <span>
            <IconButton onClick={onClose} disabled={closeDisabled} aria-label={close}>
              <AppIcon icon={X} size="lg" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ px: { xs: 1, sm: 3 }, pb: 2 }}>
        <Stepper activeStep={step} alternativeLabel>
          {steps.map((label, i) => (
            <Step key={label} completed={step > i || (i === last && step === last)}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Divider />
      <DialogContent sx={{ px: 3, py: 3 }}>{children}</DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>{actions}</DialogActions>
    </Dialog>
  );
}
